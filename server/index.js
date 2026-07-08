import express from 'express';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import https from 'https';
import dns from 'dns';
import net from 'net';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { initDb, upsertTokens, getTokens, updateTokens, revokeTokens, getBotSettings, setBotSettings, getBotStats, updateBotStats, getBotRules, upsertBotRule, deleteBotRule, markLiveDay, recordAttendanceAndGetStreak, migrateSidToUserPid, upsertSession, getSessionUserId, listChannelPoints, listChannelPointsPage, listViewerPointBalancesForUserIds, listPointViewerIdentitySummaries, listPointIdentityKeysForUserId, setChannelPoints, incrChannelPoints, getChannelPoints, getChannelPointBalanceSummary, deleteChannelPoints, clearAllChannelPoints, bulkUpsertChannelPoints, getUserAttendanceTotalDays, issueApiKey, revokeApiKey, getOwnerPidForApiKey, touchApiKeyLastUsed, getActiveApiKeyForOwner, revokeAllApiKeysForOwner, findSidByViewerToken, findSidByRouletteToken, findSidByChannelViewerTokenSupabase, getOrCreateViewerTokenSupabase, rotateViewerTokenSupabase, insertRouletteSession, getRouletteSessionByToken, listRouletteSessionsByToken, listAllSidsWithTokens, getLiveSessionFromDB, upsertLiveSessionToDB, updateLiveSessionLastUpdate, getActiveLiveSessionsFromDB, deleteOldLiveSessionsFromDB, initializeLiveSessionsOnStartup, cleanupOldSessions, upsertPlatformIdentity, listPlatformAccounts, findAppUserIdByChannelUid, updatePlatformAccountProfile, upsertPlatformTokens, getPlatformTokens, listPlatformTokenUsers, deletePlatformTokens, deletePlatformAccount, getAppUserAdminStatus, getYoutubeBotProfile, upsertYoutubeBotProfile, updateYoutubeBotProfileTokens, markYoutubeBotProfileStatus, deleteYoutubeBotProfile, getYoutubeStreamerChannel, upsertYoutubeStreamerChannel, markYoutubeStreamerChannelModeratorRegistered, deleteYoutubeStreamerChannel, listYoutubeStreamerChannelsByYoutubeChannelId, updateYoutubeStreamerChannelLive, updateYoutubeStreamerChannelWebsub, getAutomationSettings, setAutomationSettings, listAutomationConnections, findAutomationConnectionByControlTokenHash, upsertAutomationConnection, deleteAutomationConnection, enqueueAutomationJob, getOrCreateAutomationLocalAgent, listAutomationLocalAgents, authenticateAutomationLocalAgent, touchAutomationLocalAgent, claimAutomationJobsForAgent, completeAutomationJobForAgent, listPredictionsForSid, getPredictionForSid, getActivePredictionForChannel, createPrediction, lockPredictionForSid, cancelPredictionForSid, settlePredictionForSid, placePredictionBet, listActionBlueprints, getActionBlueprint, upsertActionBlueprint, publishActionBlueprint, deleteActionBlueprint, insertActionBlueprintRun, finishActionBlueprintRun, insertActionBlueprintRunStep, listActionBlueprintRuns, listActionBlueprintVersions, restoreActionBlueprintVersion, listActionBlueprintRunSteps, recordBotEventLog, listBotEventLogs, getBotEventLog, insertDrawingDonationItem, listDrawingDonationItems, getDrawingDonationItem, getCurrentDrawingDonationItem, updateDrawingDonationItemStatus, deleteDrawingDonationItem, reorderDrawingDonationItems, uploadDrawingDonationObject, deleteAccountData, cleanupPrivacyRetentionData, validateSecretEncryptionConfig, getPgPoolStatus } from './supabase.js';
import { createPlatformProfileService } from './platform-profiles.js';
import { WebSocketServer, WebSocket } from 'ws';
import youtubeChatPackage from 'youtube-chat';

dotenv.config();

const { LiveChat: YoutubeLiveChat } = youtubeChatPackage;

const VERBOSE_LOGS = process.env.ARUBOT_VERBOSE_LOGS === 'true' || process.env.NODE_ENV !== 'production';
if (!VERBOSE_LOGS) {
  const originalConsoleLog = console.log.bind(console);
  console.log = (...args) => {
    const first = String(args?.[0] || '');
    if (first.startsWith('[server]') || first.startsWith('[Server] Received') || first.startsWith('[Server] Graceful shutdown')) {
      originalConsoleLog(...args);
    }
  };
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || process.env.SERVER_PORT || 3001;
const SERVER_HOST = String(process.env.SERVER_HOST || process.env.ARUBOT_SERVER_HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '')).trim();
const OCI_METADATA_IPV4 = '169.254.169.254';
const INSTANCE_ID = 'inst_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(36);
const PROCESS_ROLE = process.env.ARUBOT_PROCESS_ROLE || 'api-runtime';
const youtubeBotOAuthPendingStore = new Map(); // ownerUserId -> { tokens, channels, createdAt }
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://arubot.yuaru.com';
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || 'https://arubotapi.yuaru.com';
const SERVER_STARTED_AT = new Date().toISOString();
const RELEASE_SHA = process.env.ARUBOT_RELEASE_SHA || process.env.RELEASE_SHA || 'local';
const DB_PROVIDER = String(process.env.ARUBOT_DB_PROVIDER || 'supabase').trim().toLowerCase() === 'postgres' ? 'postgres' : 'supabase';
const USE_POSTGRES_PROVIDER = DB_PROVIDER === 'postgres';
const ALLOW_SUPABASE_ENV_WITH_POSTGRES = String(process.env.ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES || '').trim().toLowerCase() === 'true';
function hasDirectDatabaseUrl() {
  return USE_POSTGRES_PROVIDER ? !!process.env.POSTGRES_URL : !!process.env.SUPABASE_DB_URL;
}
function shouldRefreshPostgRESTSchema() {
  return !USE_POSTGRES_PROVIDER && !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}
function shouldRunDatabaseMaintenance() {
  return hasDirectDatabaseUrl() && process.env.ARUBOT_SUPABASE_PERF_MONITORING !== 'false';
}
function validateDatabaseProviderConfig() {
  if (!USE_POSTGRES_PROVIDER || ALLOW_SUPABASE_ENV_WITH_POSTGRES) return;
  const forbiddenSupabaseEnv = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_DB_URL',
  ].filter((name) => String(process.env[name] || '').trim());
  if (forbiddenSupabaseEnv.length > 0) {
    throw new Error(`ARUBOT_DB_PROVIDER=postgres must not run with Supabase environment variables: ${forbiddenSupabaseEnv.join(', ')}. Remove them from the backend runtime, or set ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES=true only for a one-off migration command.`);
  }
}
const ALLOWED_ORIGINS = [
  FRONTEND_ORIGIN,
  BACKEND_ORIGIN,
  process.env.PUBLIC_ORIGIN,
  process.env.NEXT_PUBLIC_SITE_URL,
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
].filter(Boolean);

function isTrustedOrigin(origin) {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const o = u.origin;
    if (ALLOWED_ORIGINS.includes(o)) return true;
    if (
      ['localhost', '127.0.0.1', '::1'].includes(u.hostname) &&
      Number(u.port) >= 3000 &&
      Number(u.port) < 3100
    ) {
      return true;
    }
    return u.protocol === 'https:' && (u.hostname.endsWith('.yuaru.kr') || u.hostname.endsWith('.yuaru.com'));
  } catch {
    return false;
  }
}

const corsOptions = {
  origin: (origin, cb) => {
    return cb(null, isTrustedOrigin(origin));
  },
  credentials: true,
};

function constantTimeEqualText(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getOpsAdminToken() {
  return String(process.env.OPS_ADMIN_TOKEN || process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN || '').trim();
}

function hasOpsAdminToken(req) {
  const expected = getOpsAdminToken();
  if (!expected) return false;
  const auth = String(req.get('authorization') || '');
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const headerToken = String(req.get('x-admin-token') || '').trim();
  return constantTimeEqualText(bearer, expected) || constantTimeEqualText(headerToken, expected);
}

function requireOpsAuth(req, res, next) {
  if (hasOpsAdminToken(req)) return next();
  return res.status(getOpsAdminToken() ? 403 : 404).json({ error: 'Not found' });
}

const rateLimitBuckets = new Map();

function createIpRateLimiter({ windowMs, max, prefix }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${prefix}:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    const current = rateLimitBuckets.get(key);
    if (!current || current.resetAt <= now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: 'Too many requests' });
    }
    return next();
  };
}

const rateLimiters = {
  externalLookup: createIpRateLimiter({ prefix: 'externalLookup', windowMs: 60 * 1000, max: 30 }),
  userWrite: createIpRateLimiter({ prefix: 'userWrite', windowMs: 60 * 1000, max: 120 }),
  apiKeyCommand: createIpRateLimiter({ prefix: 'apiKeyCommand', windowMs: 60 * 1000, max: 240 }),
};

const singleFlightRequests = new Map();

function singleFlight(key, fn) {
  const existing = singleFlightRequests.get(key);
  if (existing) return existing;
  const request = Promise.resolve()
    .then(fn)
    .finally(() => {
      singleFlightRequests.delete(key);
    });
  singleFlightRequests.set(key, request);
  return request;
}

const realtimeResponseCache = new Map();
const REALTIME_CACHE_SWEEP_MS = 60 * 1000;
const REALTIME_CACHE_MAX_AGE_MS = 2 * 60 * 1000;

function cloneRealtimePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  return Array.isArray(payload) ? payload.slice() : { ...payload };
}

async function readRealtimeCached(key, options, loader) {
  const ttlMs = Math.max(250, Number(options?.ttlMs || 1000));
  const staleMs = Math.max(ttlMs, Number(options?.staleMs || ttlMs));
  const now = Date.now();
  const existing = realtimeResponseCache.get(key);
  if (existing?.value && now - existing.updatedAt <= ttlMs) {
    return cloneRealtimePayload(existing.value);
  }
  if (existing?.promise) {
    if (existing.value) return cloneRealtimePayload(existing.value);
    return cloneRealtimePayload(await existing.promise);
  }
  if (existing?.value && now - existing.updatedAt <= staleMs) {
    const refresh = Promise.resolve()
      .then(loader)
      .then((value) => {
        realtimeResponseCache.set(key, { value, updatedAt: Date.now() });
        return value;
      })
      .catch((error) => {
        realtimeResponseCache.set(key, { value: existing.value, updatedAt: existing.updatedAt });
        console.warn('[Realtime Cache] background refresh failed:', key, error?.message || error);
        return existing.value;
      });
    realtimeResponseCache.set(key, { ...existing, promise: refresh });
    refresh.catch(() => { });
    return cloneRealtimePayload(existing.value);
  }
  const request = Promise.resolve()
    .then(loader)
    .then((value) => {
      realtimeResponseCache.set(key, { value, updatedAt: Date.now() });
      return value;
    })
    .catch((error) => {
      if (existing?.value) realtimeResponseCache.set(key, { value: existing.value, updatedAt: existing.updatedAt });
      else realtimeResponseCache.delete(key);
      throw error;
    });
  realtimeResponseCache.set(key, { value: existing?.value, updatedAt: existing?.updatedAt || 0, promise: request });
  return cloneRealtimePayload(await request);
}

function invalidateRealtimePointCaches(channelUid) {
  const uid = String(channelUid || '').trim();
  for (const key of realtimeResponseCache.keys()) {
    if (key.startsWith('viewer:points:') || (uid && key.includes(`:points:${uid}:`))) {
      realtimeResponseCache.delete(key);
    }
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (!bucket || bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of realtimeResponseCache.entries()) {
    if (!entry?.promise && (!entry?.updatedAt || now - entry.updatedAt > REALTIME_CACHE_MAX_AGE_MS)) {
      realtimeResponseCache.delete(key);
    }
  }
}, REALTIME_CACHE_SWEEP_MS).unref?.();

function rejectUntrustedBrowserOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !isTrustedOrigin(origin)) {
    return res.status(403).json({ error: 'Untrusted origin' });
  }
  const referer = req.get('referer');
  if (!origin && referer) {
    try {
      if (!isTrustedOrigin(new URL(referer).origin)) {
        return res.status(403).json({ error: 'Untrusted origin' });
      }
    } catch {
      return res.status(403).json({ error: 'Untrusted origin' });
    }
  }
  return next();
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});

app.use(cors(corsOptions));
// Explicit preflight support for all routes
app.options('*', cors(corsOptions));
app.use(process.env.YOUTUBE_WEBSUB_CALLBACK_PATH || '/api/youtube/websub/callback', express.text({ type: ['application/atom+xml', 'application/xml', 'text/xml', '*/*'], limit: '1mb' }));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(rejectUntrustedBrowserOrigin);

// Serve static files (SFX, etc.) with CORS
app.use('/files', cors(corsOptions), express.static(path.join(path.dirname(new URL(import.meta.url).pathname), 'files')));

// =============================
// =============================
const sessionContextCache = new Map(); // sidToken -> { sid, channelId, userId, lastActivity, sessionKey }
const sessionStore = new Map(); // sid -> entry
const activeSids = new Map(); // sid -> lastSeenTs
const youtubeSessionStore = new Map(); // ownerUserId -> entry
const youtubeSessionCreatePromises = new Map(); // ownerUserId -> Promise(entry)
const youtubeSendQueues = new Map(); // ownerUserId -> Promise
const cimeSessionStore = new Map(); // ownerUserId -> entry
const cimeSessionCreatePromises = new Map(); // ownerUserId -> Promise(entry)
const CACHE_TTL = 5 * 60 * 1000;

const CONNECTION_CLEANUP_INTERVAL = 5 * 60 * 1000;

/**
 */
class ChannelCache {
  constructor(options = {}) {
    this.cache = new Map(); // channelId -> Map<key, { value, timestamp, ttl, accessCount }>
    this.defaultTtl = options.defaultTtl || 5 * 60 * 1000;
    this.cleanupInterval = options.cleanupInterval || 2 * 60 * 1000;
    this.maxEntriesPerChannel = options.maxEntriesPerChannel || 1000;
    this.metrics = new Map(); // channelId -> { hits, misses, evictions, totalRequests }

    //
    this.startCleanupTimer();
  }

  /**
   */
  set(channelId, key, value, ttl = null) {
    try {
      if (!channelId || !key) {
        return false;
      }

      if (!this.cache.has(channelId)) {
        this.cache.set(channelId, new Map());
        this.metrics.set(channelId, {
          hits: 0,
          misses: 0,
          evictions: 0,
          totalRequests: 0
        });
      }

      const channelCache = this.cache.get(channelId);

      if (channelCache.size >= this.maxEntriesPerChannel && !channelCache.has(key)) {
        const oldestKey = this.findOldestKey(channelCache);
        if (oldestKey) {
          channelCache.delete(oldestKey);
          const metrics = this.metrics.get(channelId);
          metrics.evictions++;
        }
      }

      const cacheEntry = {
        value,
        timestamp: Date.now(),
        ttl: ttl || this.defaultTtl,
        accessCount: 0
      };

      channelCache.set(key, cacheEntry);
      return true;

    } catch (error) {
      console.error('[ChannelCache] Error setting cache entry:', error);
      return false;
    }
  }

  /**
   */
  get(channelId, key) {
    try {
      if (!channelId || !key) {
        return null;
      }

      const channelCache = this.cache.get(channelId);
      const metrics = this.metrics.get(channelId);

      if (metrics) {
        metrics.totalRequests++;
      }

      if (!channelCache) {
        if (metrics) metrics.misses++;
        return null;
      }

      const cacheEntry = channelCache.get(key);
      if (!cacheEntry) {
        if (metrics) metrics.misses++;
        return null;
      }

      // TTL ?뺤씤
      const now = Date.now();
      if (now - cacheEntry.timestamp > cacheEntry.ttl) {
        channelCache.delete(key);
        if (metrics) metrics.misses++;
        return null;
      }

      cacheEntry.accessCount++;
      if (metrics) metrics.hits++;

      return cacheEntry.value;

    } catch (error) {
      console.error('[ChannelCache] Error getting cache entry:', error);
      return null;
    }
  }

  /**
   *
   */
  delete(channelId, key = null) {
    try {
      if (!channelId) return false;

      if (key === null) {
        const deleted = this.cache.delete(channelId);
        this.metrics.delete(channelId);
        return deleted;
      } else {
        //
        const channelCache = this.cache.get(channelId);
        if (!channelCache) return false;

        const deleted = channelCache.delete(key);

        if (channelCache.size === 0) {
          this.cache.delete(channelId);
          this.metrics.delete(channelId);
        }

        return deleted;
      }

    } catch (error) {
      console.error('[ChannelCache] Error deleting cache entry:', error);
      return false;
    }
  }

  /**
   */
  size(channelId) {
    const channelCache = this.cache.get(channelId);
    return channelCache ? channelCache.size : 0;
  }

  /**
   */
  keys(channelId) {
    const channelCache = this.cache.get(channelId);
    return channelCache ? Array.from(channelCache.keys()) : [];
  }

  /**
   */
  cleanupExpiredEntries() {
    const now = Date.now();
    let totalCleaned = 0;

    for (const [channelId, channelCache] of this.cache.entries()) {
      const expiredKeys = [];

      for (const [key, entry] of channelCache.entries()) {
        if (now - entry.timestamp > entry.ttl) {
          expiredKeys.push(key);
        }
      }

      for (const key of expiredKeys) {
        channelCache.delete(key);
        totalCleaned++;
      }

      if (channelCache.size === 0) {
        this.cache.delete(channelId);
        this.metrics.delete(channelId);
      }
    }

    return totalCleaned;
  }

  /**
   *
   */
  findOldestKey(channelCache) {
    let oldestKey = null;
    let oldestTimestamp = Date.now();

    for (const [key, entry] of channelCache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   */
  getMetrics(channelId = null) {
    if (channelId) {
      const metrics = this.metrics.get(channelId);
      if (!metrics) return null;

      const hitRate = metrics.totalRequests > 0 ? (metrics.hits / metrics.totalRequests) * 100 : 0;

      return {
        channelId,
        ...metrics,
        hitRate: Math.round(hitRate * 100) / 100,
        cacheSize: this.size(channelId)
      };
    } else {
      const totalMetrics = {
        totalChannels: this.cache.size,
        totalEntries: 0,
        totalHits: 0,
        totalMisses: 0,
        totalEvictions: 0,
        totalRequests: 0,
        channelDetails: []
      };

      for (const [cId, metrics] of this.metrics.entries()) {
        totalMetrics.totalHits += metrics.hits;
        totalMetrics.totalMisses += metrics.misses;
        totalMetrics.totalEvictions += metrics.evictions;
        totalMetrics.totalRequests += metrics.totalRequests;
        totalMetrics.totalEntries += this.size(cId);

        const hitRate = metrics.totalRequests > 0 ? (metrics.hits / metrics.totalRequests) * 100 : 0;

        totalMetrics.channelDetails.push({
          channelId: cId,
          ...metrics,
          hitRate: Math.round(hitRate * 100) / 100,
          cacheSize: this.size(cId)
        });
      }

      totalMetrics.overallHitRate = totalMetrics.totalRequests > 0
        ? Math.round((totalMetrics.totalHits / totalMetrics.totalRequests) * 10000) / 100
        : 0;

      totalMetrics.channelDetails.sort((a, b) => b.hitRate - a.hitRate);

      return totalMetrics;
    }
  }

  /**
   *
   */
  startCleanupTimer() {
    setInterval(() => {
      try {
        this.cleanupExpiredEntries();
      } catch (error) {
        console.error('[ChannelCache] Cleanup error:', error);
      }
    }, this.cleanupInterval);
  }

  /**
   */
  clear() {
    const totalChannels = this.cache.size;
    const totalEntries = Array.from(this.cache.values()).reduce((sum, cache) => sum + cache.size, 0);

    this.cache.clear();
    this.metrics.clear();
  }
}

const channelCache = new ChannelCache({
  defaultTtl: 5 * 60 * 1000,
  cleanupInterval: 2 * 60 * 1000,
  maxEntriesPerChannel: 1000
});

/**
 */
class ResourceManager {
  constructor(options = {}) {
    this.cleanupInterval = options.cleanupInterval || 10 * 60 * 1000;
    this.inactiveThreshold = options.inactiveThreshold || 60 * 60 * 1000;
    this.tokenExpiryThreshold = options.tokenExpiryThreshold || 24 * 60 * 60 * 1000;
    this.sessionExpiryThreshold = options.sessionExpiryThreshold || 7 * 24 * 60 * 60 * 1000;
    this.memoryThreshold = options.memoryThreshold || 500 * 1024 * 1024;

    this.metrics = {
      lastCleanup: 0,
      totalCleanups: 0,
      channelsCleanedUp: 0,
      tokensCleanedUp: 0,
      sessionsCleanedUp: 0,
      memoryFreed: 0,
      errors: 0
    };

    this.startCleanupScheduler();

    console.log('[ResourceManager] Initialized with cleanup interval:', this.cleanupInterval);
  }

  /**
   */
  async cleanupInactiveChannels() {
    const startTime = Date.now();
    const results = {
      channelsProcessed: 0,
      channelsCleanedUp: 0,
      resourcesFreed: 0,
      errors: []
    };

    try {
      console.log('[ResourceManager] Starting inactive channel cleanup...');

      const poolCleanup = connectionPool.cleanupInactiveChannels();
      results.channelsCleanedUp += poolCleanup;

      const cacheMetrics = channelCache.getMetrics();
      const now = Date.now();

      for (const channelDetail of cacheMetrics.channelDetails) {
        results.channelsProcessed++;

        if (channelDetail.cacheSize === 0 ||
          (now - channelDetail.lastActivity) > this.inactiveThreshold) {

          const deleted = channelCache.delete(channelDetail.channelId);
          if (deleted) {
            results.channelsCleanedUp++;
            results.resourcesFreed += channelDetail.cacheSize;
            console.log(`[ResourceManager] Cleaned up inactive channel: ${channelDetail.channelId}`);
          }
        }
      }

      const legacyCleanup = this.cleanupLegacySessionCache();
      results.resourcesFreed += legacyCleanup;

      const duration = Date.now() - startTime;
      console.log(`[ResourceManager] Inactive channel cleanup completed in ${duration}ms: ${results.channelsCleanedUp}/${results.channelsProcessed} channels cleaned`);

      return results;

    } catch (error) {
      console.error('[ResourceManager] Error during inactive channel cleanup:', error);
      results.errors.push(error.message);
      this.metrics.errors++;
      return results;
    }
  }

  /**
   */
  async cleanupExpiredTokens() {
    const startTime = Date.now();
    const results = {
      tokensProcessed: 0,
      tokensCleanedUp: 0,
      errors: []
    };

    try {
      console.log('[ResourceManager] Starting expired token cleanup...');

      const now = Date.now();

      for (const [token, sid] of rouletteTokenToSid.entries()) {
        results.tokensProcessed++;

        try {
          const channelContext = await getChannelContext(sid);
          if (!channelContext ||
            (now - channelContext.lastActivity) > this.tokenExpiryThreshold) {

            rouletteTokenToSid.delete(token);
            results.tokensCleanedUp++;
            console.log(`[ResourceManager] Cleaned up expired roulette token: ${token.substring(0, 8)}...`);
          }
        } catch (error) {
          rouletteTokenToSid.delete(token);
          results.tokensCleanedUp++;
          results.errors.push(`Failed to validate token ${token.substring(0, 8)}...: ${error.message}`);
        }
      }

      for (const [token, sid] of pvdTokenToSid.entries()) {
        results.tokensProcessed++;

        try {
          const channelContext = await getChannelContext(sid);
          if (!channelContext ||
            (now - channelContext.lastActivity) > this.tokenExpiryThreshold) {

            pvdTokenToSid.delete(token);
            results.tokensCleanedUp++;
            console.log(`[ResourceManager] Cleaned up expired PVD token: ${token.substring(0, 8)}...`);
          }
        } catch (error) {
          pvdTokenToSid.delete(token);
          results.tokensCleanedUp++;
          results.errors.push(`Failed to validate PVD token ${token.substring(0, 8)}...: ${error.message}`);
        }
      }

      const mappingCleanup = this.cleanupTokenChannelMapping();
      results.tokensCleanedUp += mappingCleanup;

      const duration = Date.now() - startTime;
      console.log(`[ResourceManager] Token cleanup completed in ${duration}ms: ${results.tokensCleanedUp}/${results.tokensProcessed} tokens cleaned`);

      return results;

    } catch (error) {
      console.error('[ResourceManager] Error during token cleanup:', error);
      results.errors.push(error.message);
      this.metrics.errors++;
      return results;
    }
  }

  /**
   */
  async cleanupExpiredSessions() {
    const startTime = Date.now();
    const results = {
      sessionsProcessed: 0,
      sessionsCleanedUp: 0,
      errors: []
    };

    try {
      console.log('[ResourceManager] Starting expired session cleanup...');

      const now = Date.now();

      for (const [sid, queue] of videoDonationQueues.entries()) {
        results.sessionsProcessed++;

        try {
          const channelContext = await getChannelContext(sid);
          if (!channelContext ||
            (now - channelContext.lastActivity) > this.sessionExpiryThreshold) {

            videoDonationQueues.delete(sid);
            pvdAdminSockets.delete(sid);

            const timer = videoDonationTimers.get(sid);
            if (timer) {
              clearTimeout(timer);
              videoDonationTimers.delete(sid);
            }

            results.sessionsCleanedUp++;
            console.log(`[ResourceManager] Cleaned up expired video donation session: ${sid}`);
          }
        } catch (error) {
          videoDonationQueues.delete(sid);
          videoDonationTimers.delete(sid);
          pvdAdminSockets.delete(sid);
          results.sessionsCleanedUp++;
          results.errors.push(`Failed to validate session ${sid}: ${error.message}`);
        }
      }

      for (const [sid, queue] of rouletteQueues.entries()) {
        results.sessionsProcessed++;

        try {
          const channelContext = await getChannelContext(sid);
          if (!channelContext ||
            (now - channelContext.lastActivity) > this.sessionExpiryThreshold) {

            rouletteQueues.delete(sid);
            rouletteProcessing.delete(sid);
            results.sessionsCleanedUp++;
            console.log(`[ResourceManager] Cleaned up expired roulette session: ${sid}`);
          }
        } catch (error) {
          rouletteQueues.delete(sid);
          rouletteProcessing.delete(sid);
          results.sessionsCleanedUp++;
          results.errors.push(`Failed to validate roulette session ${sid}: ${error.message}`);
        }
      }

      // PVD ?뚯폆 ?뺣━
      for (const [sid, sockets] of pvdSidSockets.entries()) {
        results.sessionsProcessed++;

        try {
          const channelContext = await getChannelContext(sid);
          if (!channelContext ||
            (now - channelContext.lastActivity) > this.sessionExpiryThreshold) {

            for (const ws of sockets) {
              try {
                ws.close(1001, 'Session expired');
              } catch (e) {
              }
            }

            pvdSidSockets.delete(sid);
            results.sessionsCleanedUp++;
            console.log(`[ResourceManager] Cleaned up expired PVD socket session: ${sid}`);
          }
        } catch (error) {
          pvdSidSockets.delete(sid);
          results.sessionsCleanedUp++;
          results.errors.push(`Failed to validate PVD session ${sid}: ${error.message}`);
        }
      }

      for (const [sid, sockets] of pvdAdminSockets.entries()) {
        results.sessionsProcessed++;

        try {
          const channelContext = await getChannelContext(sid);
          if (!channelContext ||
            (now - channelContext.lastActivity) > this.sessionExpiryThreshold) {

            for (const ws of sockets) {
              try {
                ws.close(1001, 'Session expired');
              } catch { }
            }

            pvdAdminSockets.delete(sid);
            results.sessionsCleanedUp++;
            console.log(`[ResourceManager] Cleaned up expired PVD admin socket session: ${sid}`);
          }
        } catch (error) {
          pvdAdminSockets.delete(sid);
          results.sessionsCleanedUp++;
          results.errors.push(`Failed to validate PVD admin session ${sid}: ${error.message}`);
        }
      }

      const duration = Date.now() - startTime;
      console.log(`[ResourceManager] Session cleanup completed in ${duration}ms: ${results.sessionsCleanedUp}/${results.sessionsProcessed} sessions cleaned`);

      return results;

    } catch (error) {
      console.error('[ResourceManager] Error during session cleanup:', error);
      results.errors.push(error.message);
      this.metrics.errors++;
      return results;
    }
  }

  /**
   *
   */
  cleanupLegacySessionCache() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, context] of sessionContextCache.entries()) {
      if (now - context.lastActivity > CACHE_TTL) {
        sessionContextCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[ResourceManager] Cleaned up ${cleanedCount} legacy session cache entries`);
    }

    return cleanedCount;
  }

  /**
   */
  cleanupTokenChannelMapping() {
    if (typeof channelTokenMapping !== 'undefined') {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [token, mapping] of channelTokenMapping.entries()) {
        if (mapping.lastUsed && (now - mapping.lastUsed) > this.tokenExpiryThreshold) {
          channelTokenMapping.delete(token);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`[ResourceManager] Cleaned up ${cleanedCount} token-channel mappings`);
      }

      return cleanedCount;
    }

    return 0;
  }

  /**
   */
  getMemoryUsage() {
    const usage = process.memoryUsage();

    return {
      rss: usage.rss, // Resident Set Size
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers,
      timestamp: Date.now(),
      thresholdExceeded: usage.heapUsed > this.memoryThreshold,
      cacheSize: {
        channelCache: channelCache.getMetrics().totalEntries,
        sessionCache: sessionContextCache.size,
        rouletteTokens: rouletteTokenToSid.size,
        pvdTokens: pvdTokenToSid.size,
        videoDonationQueues: videoDonationQueues.size,
        rouletteQueues: rouletteQueues.size,
        pvdSockets: pvdSidSockets.size
      }
    };
  }

  /**
   *
   */
  async performFullCleanup(force = false) {
    const startTime = Date.now();
    console.log(`[ResourceManager] Starting full cleanup (force: ${force})...`);

    const results = {
      channels: await this.cleanupInactiveChannels(),
      tokens: await this.cleanupExpiredTokens(),
      sessions: await this.cleanupExpiredSessions(),
      memoryBefore: this.getMemoryUsage(),
      memoryAfter: null,
      duration: 0,
      timestamp: new Date().toISOString()
    };

    if (force && global.gc) {
      console.log('[ResourceManager] Running forced garbage collection...');
      global.gc();
    }

    results.memoryAfter = this.getMemoryUsage();
    results.duration = Date.now() - startTime;

    this.metrics.lastCleanup = Date.now();
    this.metrics.totalCleanups++;
    this.metrics.channelsCleanedUp += results.channels.channelsCleanedUp;
    this.metrics.tokensCleanedUp += results.tokens.tokensCleanedUp;
    this.metrics.sessionsCleanedUp += results.sessions.sessionsCleanedUp;
    this.metrics.memoryFreed += (results.memoryBefore.heapUsed - results.memoryAfter.heapUsed);

    console.log(`[ResourceManager] Full cleanup completed in ${results.duration}ms`);
    console.log(`[ResourceManager] Cleaned: ${results.channels.channelsCleanedUp} channels, ${results.tokens.tokensCleanedUp} tokens, ${results.sessions.sessionsCleanedUp} sessions`);

    return results;
  }

  /**
   */
  startCleanupScheduler() {
    setInterval(async () => {
      try {
        const memoryUsage = this.getMemoryUsage();

        const forceCleanup = memoryUsage.thresholdExceeded;

        if (forceCleanup) {
          console.log('[ResourceManager] Memory threshold exceeded, performing forced cleanup...');
        }

        await this.performFullCleanup(forceCleanup);

      } catch (error) {
        console.error('[ResourceManager] Scheduled cleanup error:', error);
        this.metrics.errors++;
      }
    }, this.cleanupInterval);

    console.log(`[ResourceManager] Cleanup scheduler started (interval: ${this.cleanupInterval}ms)`);
  }

  /**
   * @returns {Object} - ?듦퀎 ?뺣낫
   */
  getStatistics() {
    const memoryUsage = this.getMemoryUsage();

    return {
      metrics: { ...this.metrics },
      memoryUsage,
      configuration: {
        cleanupInterval: this.cleanupInterval,
        inactiveThreshold: this.inactiveThreshold,
        tokenExpiryThreshold: this.tokenExpiryThreshold,
        sessionExpiryThreshold: this.sessionExpiryThreshold,
        memoryThreshold: this.memoryThreshold
      },
      nextCleanup: this.metrics.lastCleanup + this.cleanupInterval,
      timestamp: Date.now()
    };
  }

  /**
   *
   */
  shutdown() {
    console.log('[ResourceManager] Shutting down...');

    this.performFullCleanup(true).then(() => {
      console.log('[ResourceManager] Shutdown cleanup completed');
    }).catch(error => {
      console.error('[ResourceManager] Shutdown cleanup error:', error);
    });
  }
}

const resourceManager = new ResourceManager({
  cleanupInterval: 10 * 60 * 1000,
  inactiveThreshold: 60 * 60 * 1000,
  tokenExpiryThreshold: 24 * 60 * 60 * 1000,
  sessionExpiryThreshold: 7 * 24 * 60 * 60 * 1000,
  memoryThreshold: 500 * 1024 * 1024
});

function getUserIdFromChannelId(channelId) {
  return String(channelId || '');
}

function cleanupSessionCache() {
  const now = Date.now();
  for (const [key, context] of sessionContextCache.entries()) {
    if (now - context.lastActivity > CACHE_TTL) {
      sessionContextCache.delete(key);
    }
  }
}

setInterval(cleanupSessionCache, CACHE_TTL);

// =============================
// =============================

/**
 * @returns {boolean} - ?깅줉 ?깃났 ?щ?
 */
function registerChannelConnection(channelId, tokenType, token, ws) {
  try {
    if (!channelId || !tokenType || !token || !ws) {
      console.error('[Channel Connection] Invalid parameters for registration');
      return false;
    }

    if (tokenType !== 'roulette' && tokenType !== 'pvd') {
      console.error(`[Channel Connection] Invalid token type: ${tokenType}`);
      return false;
    }

    if (typeof channelId !== 'string' || channelId.length === 0) {
      console.error(`[Channel Connection] Invalid channel ID: ${channelId}`);
      return false;
    }

    if (typeof token !== 'string' || token.length < 8) {
      console.error(`[Channel Connection] Invalid token format: ${token?.substring(0, 8)}...`);
      return false;
    }

    if (ws.readyState !== 1) { // WebSocket.OPEN
      console.error(`[Channel Connection] WebSocket not in OPEN state: ${ws.readyState}`);
      return false;
    }

    if (tokenType === 'roulette') {
      const cachedSid = rouletteTokenToSid.get(token);
      if (cachedSid) {
        try {
          const cacheKey = `${cachedSid}_context`;
          const cachedContext = channelCache.get(channelId, cacheKey);

          if (cachedContext && cachedContext.channelId !== channelId) {
            console.warn(`[Channel Connection] Token-channel mapping mismatch: token ${token.substring(0, 8)}... maps to channel ${cachedContext.channelId}, but trying to register for ${channelId}`);
            return false;
          }

          if (cachedContext && cachedContext.channelId === channelId) {
            console.log(`[Channel Connection] Token-channel mapping verified from cache: ${token.substring(0, 8)}... -> ${channelId}`);
          }
        } catch (contextError) {
          console.warn(`[Channel Connection] Could not verify token-channel mapping: ${contextError.message}`);
        }
      } else {
        console.warn(`[Channel Connection] Roulette token not found in cache during registration: ${token.substring(0, 8)}...`);
      }
    } else if (tokenType === 'pvd') {
      const cachedSid = pvdTokenToSid.get(token);
      if (cachedSid) {
        try {
          const cacheKey = `${cachedSid}_context`;
          const cachedContext = channelCache.get(channelId, cacheKey);

          if (cachedContext && cachedContext.channelId !== channelId) {
            console.warn(`[Channel Connection] PVD token-channel mapping mismatch: token ${token.substring(0, 8)}... maps to channel ${cachedContext.channelId}, but trying to register for ${channelId}`);
            return false;
          }

          if (cachedContext && cachedContext.channelId === channelId) {
            console.log(`[Channel Connection] PVD token-channel mapping verified from cache: ${token.substring(0, 8)}... -> ${channelId}`);
          }
        } catch (contextError) {
          console.warn(`[Channel Connection] Could not verify PVD token-channel mapping: ${contextError.message}`);
        }
      } else {
        console.warn(`[Channel Connection] PVD token not found in cache during registration: ${token.substring(0, 8)}...`);
      }
    }

    const poolSuccess = connectionPool.addConnection(channelId, tokenType, token, ws);

    if (poolSuccess) {
      const connectionMap = tokenType === 'roulette' ? channelRouletteConnections : channelPvdConnections;

      if (!connectionMap.has(channelId)) {
        connectionMap.set(channelId, new Map());
      }

      const channelMap = connectionMap.get(channelId);

      if (!channelMap.has(token)) {
        channelMap.set(token, new Set());
      }

      channelMap.get(token).add(ws);

      if (tokenType === 'roulette') {
        const currentSid = rouletteTokenToSid.get(token);
        if (currentSid) {
          const cacheKey = `${currentSid}_context`;
          const contextData = {
            channelId: channelId,
            sid: currentSid,
            tokenType: tokenType,
            lastVerified: Date.now()
          };
          channelCache.set(channelId, cacheKey, contextData, 10 * 60 * 1000);
          console.log(`[Channel Connection] Cached roulette token-channel mapping: ${token.substring(0, 8)}... -> ${channelId}`);
        }
      } else if (tokenType === 'pvd') {
        const currentSid = pvdTokenToSid.get(token);
        if (currentSid) {
          const cacheKey = `${currentSid}_context`;
          const contextData = {
            channelId: channelId,
            sid: currentSid,
            tokenType: tokenType,
            lastVerified: Date.now()
          };
          channelCache.set(channelId, cacheKey, contextData, 10 * 60 * 1000);
          console.log(`[Channel Connection] Cached PVD token-channel mapping: ${token.substring(0, 8)}... -> ${channelId}`);
        }
      }

      console.log(`[Channel Connection] Successfully registered ${tokenType} connection - Channel: ${channelId}, Token: ${token.substring(0, 8)}...`);
    }

    return poolSuccess;

  } catch (error) {
    console.error('[Channel Connection] Registration error:', error);
    return false;
  }
}

/**
 */
function unregisterChannelConnection(channelId, tokenType, token, ws) {
  try {
    if (!channelId || !tokenType || !token || !ws) {
      return;
    }

    const connectionMap = tokenType === 'roulette' ? channelRouletteConnections : channelPvdConnections;
    const channelMap = connectionMap.get(channelId);

    if (!channelMap) return;

    const tokenSet = channelMap.get(token);
    if (!tokenSet) return;

    tokenSet.delete(ws);

    if (tokenSet.size === 0) {
      channelMap.delete(token);
      console.log(`[Channel Connection] Removed empty token set - Channel: ${channelId}, Token: ${token.substring(0, 8)}...`);
    }

    if (channelMap.size === 0) {
      connectionMap.delete(channelId);
      console.log(`[Channel Connection] Removed empty channel - Channel: ${channelId}, Type: ${tokenType}`);
    }

    console.log(`[Channel Connection] Unregistered ${tokenType} connection - Channel: ${channelId}, Token: ${token.substring(0, 8)}...`);

  } catch (error) {
    console.error('[Channel Connection] Unregistration error:', error);
  }
}

/**
 */
function cleanupChannelConnections() {
  try {
    const connectionMaps = [
      { name: 'roulette', map: channelRouletteConnections },
      { name: 'pvd', map: channelPvdConnections }
    ];

    let totalCleaned = 0;

    for (const { name, map } of connectionMaps) {
      for (const [channelId, channelMap] of map.entries()) {
        for (const [token, tokenSet] of channelMap.entries()) {
          const deadConnections = [];

          for (const ws of tokenSet) {
            if (ws.readyState !== 1) { // WebSocket.OPEN
              deadConnections.push(ws);
            }
          }

          for (const ws of deadConnections) {
            tokenSet.delete(ws);
            totalCleaned++;
          }

          if (tokenSet.size === 0) {
            channelMap.delete(token);
          }
        }

        if (channelMap.size === 0) {
          map.delete(channelId);
        }
      }
    }

    if (totalCleaned > 0) {
      console.log(`[Channel Connection] Cleaned up ${totalCleaned} dead connections`);
    }

  } catch (error) {
    console.error('[Channel Connection] Cleanup error:', error);
  }
}

/**
 */
function getChannelConnectionStats(channelId = null) {
  try {
    const stats = {
      roulette: {},
      pvd: {},
      total: { roulette: 0, pvd: 0 }
    };

    for (const [cId, channelMap] of channelRouletteConnections.entries()) {
      if (channelId && cId !== channelId) continue;

      let channelTotal = 0;
      for (const [token, tokenSet] of channelMap.entries()) {
        channelTotal += tokenSet.size;
      }

      stats.roulette[cId] = channelTotal;
      stats.total.roulette += channelTotal;
    }

    for (const [cId, channelMap] of channelPvdConnections.entries()) {
      if (channelId && cId !== channelId) continue;

      let channelTotal = 0;
      for (const [token, tokenSet] of channelMap.entries()) {
        channelTotal += tokenSet.size;
      }

      stats.pvd[cId] = channelTotal;
      stats.total.pvd += channelTotal;
    }

    return stats;

  } catch (error) {
    console.error('[Channel Connection] Stats error:', error);
    return { roulette: {}, pvd: {}, total: { roulette: 0, pvd: 0 } };
  }
}

setInterval(cleanupChannelConnections, CONNECTION_CLEANUP_INTERVAL);

/**
 */
async function getChannelIdFromToken(token, tokenType, trackUsage = true) {
  try {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      console.warn('[Token Channel] Invalid token provided');
      return null;
    }

    if (!tokenType || !['roulette', 'pvd'].includes(tokenType)) {
      console.warn('[Token Channel] Invalid token type provided:', tokenType);
      return null;
    }

    let sid = null;
    let channelId = null;

    const cachedMapping = channelTokenMapping.get(token);
    if (cachedMapping && cachedMapping.channelId) {
      const now = Date.now();
      const cacheAge = now - (cachedMapping.timestamp || 0);
      const maxCacheAge = 5 * 60 * 1000;

      if (cacheAge < maxCacheAge) {
        channelId = cachedMapping.channelId;

        cachedMapping.lastUsed = now;

        if (trackUsage) {
          const context = arguments[3] || {};
          trackTokenUsage(token, channelId, tokenType,
            context.userId, context.ip, context.userAgent);
        }

        console.log(`[Token Channel] Cache hit for token: ${token.substring(0, 8)}... -> ${channelId}`);
        return channelId;
      } else {
        channelTokenMapping.delete(token);
        console.log(`[Token Channel] Expired cache removed for token: ${token.substring(0, 8)}...`);
      }
    }

    if (tokenType === 'roulette') {
      sid = rouletteTokenToSid.get(token);

      if (!sid) {
        //
        sid = await findSidByRouletteToken(token);
        if (sid) {
          rouletteTokenToSid.set(token, sid);
          console.log(`[Token Channel] Roulette SID cached: ${token.substring(0, 8)}... -> ${sid}`);
        } else {
          console.warn(`[Token Channel] Roulette SID not found for token: ${token.substring(0, 8)}...`);
        }
      }
    } else if (tokenType === 'pvd') {
      sid = pvdTokenToSid.get(token);

      if (!sid) {
        //
        sid = await findSidByViewerToken(token);
        if (sid) {
          pvdTokenToSid.set(token, sid);
          console.log(`[Token Channel] PVD SID cached: ${token.substring(0, 8)}... -> ${sid}`);
        } else {
          console.warn(`[Token Channel] PVD SID not found for token: ${token.substring(0, 8)}...`);
        }
      }
    }

    if (!sid) {
      console.warn(`[Token Channel] No SID found for token: ${token.substring(0, 8)}...`);
      return null;
    }

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      console.warn(`[Token Channel] No channel context found for SID: ${sid}`);
      return null;
    }

    channelId = channelContext.channelId;
    if (!channelId) {
      console.warn(`[Token Channel] No channel ID in context for SID: ${sid}`);
      return null;
    }

    if (typeof channelId !== 'string' || channelId.trim().length === 0) {
      console.warn(`[Token Channel] Invalid channel ID format: ${channelId}`);
      return null;
    }

    registerTokenChannelMapping(token, channelId);

    if (trackUsage) {
      const context = arguments[3] || {};
      trackTokenUsage(token, channelId, tokenType,
        context.userId, context.ip, context.userAgent);
    }

    console.log(`[Token Channel] Successfully extracted channel ID: ${token.substring(0, 8)}... -> ${channelId}`);
    return channelId;

  } catch (error) {
    console.error('[Token Channel] Error extracting channel ID from token:', error);
    return null;
  }
}

/**
 */
async function broadcastToChannel(channelId, tokenType, message, specificToken = null) {
  try {
    if (!channelId || typeof channelId !== 'string' || channelId.trim().length === 0) {
      const error = new Error('Invalid channel ID provided');
      error.code = 'INVALID_CHANNEL_ID';
      console.error('[Channel Broadcast] Invalid channel ID:', channelId);
      throw error;
    }

    if (!tokenType || (tokenType !== 'roulette' && tokenType !== 'pvd')) {
      const error = new Error(`Invalid token type: ${tokenType}`);
      error.code = 'INVALID_TOKEN_TYPE';
      console.error('[Channel Broadcast] Invalid token type:', tokenType);
      throw error;
    }

    if (!message || typeof message !== 'object') {
      const error = new Error('Invalid message object provided');
      error.code = 'INVALID_MESSAGE';
      console.error('[Channel Broadcast] Invalid message:', message);
      throw error;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(channelId)) {
      const error = new Error(`Invalid channel ID format: ${channelId}`);
      error.code = 'INVALID_CHANNEL_FORMAT';
      console.error('[Channel Broadcast] Invalid channel ID format:', channelId);
      throw error;
    }

    const connectionMap = tokenType === 'roulette' ? channelRouletteConnections : channelPvdConnections;
    const channelMap = connectionMap.get(channelId);

    if (!channelMap || channelMap.size === 0) {
      console.log(`[Channel Broadcast] No connections for channel: ${channelId}, type: ${tokenType}`);
      return {
        success: 0,
        failed: 0,
        total: 0,
        error: 'NO_CONNECTIONS',
        channelId,
        tokenType
      };
    }

    let totalConnections = 0;
    let successCount = 0;
    let failedCount = 0;
    const failedConnections = [];
    const deadConnections = [];

    const enhancedMessage = {
      ...message,
      channelId,
      serverTimestamp: Date.now()
    };

    let messageStr;
    try {
      messageStr = JSON.stringify(enhancedMessage);
    } catch (jsonError) {
      const error = new Error(`Failed to serialize message: ${jsonError.message}`);
      error.code = 'MESSAGE_SERIALIZATION_ERROR';
      console.error('[Channel Broadcast] Message serialization error:', jsonError);
      throw error;
    }

    if (specificToken) {
      if (typeof specificToken !== 'string' || specificToken.trim().length === 0) {
        const error = new Error(`Invalid specific token provided: ${specificToken}`);
        error.code = 'INVALID_SPECIFIC_TOKEN';
        console.error('[Channel Broadcast] Invalid specific token:', specificToken);
        throw error;
      }

      try {
        const isValidMapping = await validateTokenChannelMapping(specificToken, channelId, tokenType);
        if (!isValidMapping) {
          const error = new Error(`Token-channel mapping validation failed: token ${specificToken.substring(0, 8)}... does not belong to channel ${channelId}`);
          error.code = 'TOKEN_CHANNEL_MISMATCH';
          console.error('[Channel Broadcast] Token-channel mismatch:', error.message);
          throw error;
        }
      } catch (validationError) {
        if (validationError.code === 'TOKEN_CHANNEL_MISMATCH') {
          throw validationError;
        }
        console.warn(`[Channel Broadcast] Could not validate token-channel mapping: ${validationError.message}`);
      }

      const tokenSet = channelMap.get(specificToken);
      if (tokenSet && tokenSet.size > 0) {
        console.log(`[Channel Broadcast] Broadcasting to ${tokenSet.size} connections for specific token: ${specificToken.substring(0, 8)}... in channel: ${channelId}`);

        for (const ws of tokenSet) {
          totalConnections++;

          const connectionStatus = validateWebSocketConnection(ws);
          if (!connectionStatus.isValid) {
            console.warn(`[Channel Broadcast] Invalid WebSocket connection for token ${specificToken.substring(0, 8)}...: ${connectionStatus.reason}`);
            failedCount++;
            failedConnections.push({
              token: specificToken.substring(0, 8) + '...',
              reason: connectionStatus.reason,
              state: ws.readyState
            });

            if (connectionStatus.shouldRemove) {
              deadConnections.push({ token: specificToken, ws });
            }
            continue;
          }

          try {
            if (ws.readyState === 1) { // WebSocket.OPEN
              ws.send(messageStr, { compress: false });
              successCount++;
            } else {
              const reason = `WebSocket not open (state: ${ws.readyState})`;
              console.warn(`[Channel Broadcast] ${reason} for token: ${specificToken.substring(0, 8)}...`);
              failedCount++;
              failedConnections.push({
                token: specificToken.substring(0, 8) + '...',
                reason,
                state: ws.readyState
              });

              if (ws.readyState === 3) { // WebSocket.CLOSED
                deadConnections.push({ token: specificToken, ws });
              }
            }
          } catch (sendError) {
            const reason = `Send error: ${sendError.message}`;
            console.error(`[Channel Broadcast] ${reason} for token ${specificToken.substring(0, 8)}...`);
            failedCount++;
            failedConnections.push({
              token: specificToken.substring(0, 8) + '...',
              reason,
              error: sendError.message
            });

            deadConnections.push({ token: specificToken, ws });
          }
        }
      } else {
        console.warn(`[Channel Broadcast] No connections found for specific token: ${specificToken.substring(0, 8)}... in channel: ${channelId}`);
        return {
          success: 0,
          failed: 0,
          total: 0,
          error: 'TOKEN_NOT_FOUND',
          channelId,
          tokenType,
          specificToken: specificToken.substring(0, 8) + '...'
        };
      }
    } else {
      for (const [token, tokenSet] of channelMap.entries()) {
        for (const ws of tokenSet) {
          totalConnections++;

          const connectionStatus = validateWebSocketConnection(ws);
          if (!connectionStatus.isValid) {
            failedCount++;
            failedConnections.push({
              token: token.substring(0, 8) + '...',
              reason: connectionStatus.reason,
              state: ws.readyState
            });

            if (connectionStatus.shouldRemove) {
              deadConnections.push({ token, ws });
            }
            continue;
          }

          try {
            if (ws.readyState === 1) { // WebSocket.OPEN
              ws.send(messageStr, { compress: false });
              successCount++;
            } else {
              failedCount++;
              failedConnections.push({
                token: token.substring(0, 8) + '...',
                reason: `WebSocket not open (state: ${ws.readyState})`,
                state: ws.readyState
              });

              if (ws.readyState === 3) { // WebSocket.CLOSED
                deadConnections.push({ token, ws });
              }
            }
          } catch (sendError) {
            console.error(`[Channel Broadcast] Send error for token ${token.substring(0, 8)}...:`, sendError.message);
            failedCount++;
            failedConnections.push({
              token: token.substring(0, 8) + '...',
              reason: `Send error: ${sendError.message}`,
              error: sendError.message
            });

            deadConnections.push({ token, ws });
          }
        }
      }
    }

    if (deadConnections.length > 0) {
      console.log(`[Channel Broadcast] Cleaning up ${deadConnections.length} dead connections in channel ${channelId}`);
      for (const { token, ws } of deadConnections) {
        try {
          const tokenSet = channelMap.get(token);
          if (tokenSet) {
            tokenSet.delete(ws);
            if (tokenSet.size === 0) {
              channelMap.delete(token);
            }
          }
        } catch (cleanupError) {
          console.error(`[Channel Broadcast] Error cleaning up dead connection:`, cleanupError);
        }
      }

      if (channelMap.size === 0) {
        connectionMap.delete(channelId);
      }
    }

    const result = {
      success: successCount,
      failed: failedCount,
      total: totalConnections,
      channelId,
      tokenType,
      deadConnectionsRemoved: deadConnections.length
    };

    if (failedConnections.length > 0) {
      result.failedConnections = failedConnections;
    }

    if (successCount === 0 && totalConnections > 0) {
      const error = new Error(`All ${totalConnections} connections failed to receive message in channel ${channelId}`);
      error.code = 'BROADCAST_COMPLETE_FAILURE';
      error.details = result;
      console.error('[Channel Broadcast] Complete broadcast failure:', error.message);
      throw error;
    }

    if (failedCount > successCount && totalConnections > 1) {
      console.warn(`[Channel Broadcast] High failure rate: ${failedCount}/${totalConnections} failed in channel ${channelId}`);
      result.warning = 'HIGH_FAILURE_RATE';
    }

    console.log(`[Channel Broadcast] ${tokenType} to channel ${channelId}: ${successCount}/${totalConnections} successful${specificToken ? ` (token: ${specificToken.substring(0, 8)}...)` : ''}${deadConnections.length > 0 ? `, cleaned ${deadConnections.length} dead connections` : ''}`);

    return result;

  } catch (error) {
    console.error('[Channel Broadcast] Error:', error.message);

    const errorResult = {
      success: 0,
      failed: 0,
      total: 0,
      error: error.code || 'UNKNOWN_ERROR',
      errorMessage: error.message,
      channelId: channelId || null,
      tokenType: tokenType || null
    };

    if (specificToken) {
      errorResult.specificToken = specificToken.substring(0, 8) + '...';
    }

    if (error.details) {
      errorResult.details = error.details;
    }

    return errorResult;
  }
}

/**
 * @param {string} sid - Session ID
 */
async function broadcastToChannelBySid(sid, tokenType, message, specificToken = null) {
  try {
    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      console.warn('[Channel Broadcast] No channel context for sid:', sid);
      return { success: 0, failed: 0, total: 0 };
    }

    return await broadcastToChannel(channelContext.channelId, tokenType, message, specificToken);

  } catch (error) {
    console.error('[Channel Broadcast] Error broadcasting by sid:', error);
    return { success: 0, failed: 0, total: 0 };
  }
}

// =============================
// Points Video Donation (PVD)
// =============================
// Settings are stored inside existing bot settings per sid:
// - videoDonationPointsPerSecond: number (default 1)
// - videoDonationAcceptEnabled: boolean (default false)
// - videoDonationMaxDurationSec: number (default 600)
// Queue is in-memory per sid for now
const videoDonationQueues = new Map(); // sid -> array of requests
const videoDonationTimers = new Map(); // sid -> NodeJS.Timeout
const pvdSidSockets = new Map(); // sid -> Set<WebSocket>
const pvdAdminSockets = new Map(); // sid -> Set<WebSocket>
const pvdTokenToSid = new Map(); // token -> sid (in-memory reverse index)

// =============================
// Drawing Donation
// =============================
const drawingDonationQueues = new Map(); // sid -> array of drawing donation requests
const drawingTokenToSid = new Map(); // token -> sid (in-memory reverse index)
const drawingOverlaySockets = new Map(); // sid -> Set<WebSocket>
const drawingAdminSockets = new Map(); // sid -> Set<WebSocket>
const drawingLivePlaybackCache = new Map(); // key -> { expiresAt, value }
const viewerPlatformLiveCache = new Map(); // key -> { expiresAt, value }

// =============================
// =============================
// =============================

/**
 */
class ChannelConnectionPool {
  constructor(options = {}) {
    this.pools = new Map(); // channelId -> Map<tokenType, Map<token, Set<WebSocket>>>
    this.maxConnectionsPerChannel = options.maxConnectionsPerChannel || 100;
    this.maxConnectionsPerToken = options.maxConnectionsPerToken || 10;
    this.cleanupInterval = options.cleanupInterval || 5 * 60 * 1000;
    this.connectionMetrics = new Map(); // channelId -> { totalConnections, lastActivity, createdAt }
    this.inactiveThreshold = options.inactiveThreshold || 30 * 60 * 1000;

    //
    this.startCleanupTimer();

    console.log('[ChannelConnectionPool] Initialized with max connections per channel:', this.maxConnectionsPerChannel);
  }

  /**
   *
   */
  addConnection(channelId, tokenType, token, ws) {
    try {
      if (!channelId || !tokenType || !token || !ws) {
        console.warn('[ChannelConnectionPool] Invalid parameters for addConnection');
        return false;
      }

      const channelTotalConnections = this.getChannelConnectionCount(channelId);
      if (channelTotalConnections >= this.maxConnectionsPerChannel) {
        console.warn(`[ChannelConnectionPool] Channel ${channelId} reached max connections (${this.maxConnectionsPerChannel})`);
        return false;
      }

      if (!this.pools.has(channelId)) {
        this.pools.set(channelId, new Map());
        this.connectionMetrics.set(channelId, {
          totalConnections: 0,
          lastActivity: Date.now(),
          createdAt: Date.now()
        });
      }

      const channelPool = this.pools.get(channelId);

      if (!channelPool.has(tokenType)) {
        channelPool.set(tokenType, new Map());
      }

      const typePool = channelPool.get(tokenType);

      if (!typePool.has(token)) {
        typePool.set(token, new Set());
      }

      const tokenConnections = typePool.get(token);

      if (tokenConnections.size >= this.maxConnectionsPerToken) {
        console.warn(`[ChannelConnectionPool] Token ${token.substring(0, 8)}... reached max connections (${this.maxConnectionsPerToken})`);
        return false;
      }

      tokenConnections.add(ws);

      const metrics = this.connectionMetrics.get(channelId);
      metrics.totalConnections++;
      metrics.lastActivity = Date.now();

      ws.on('close', () => {
        this.removeConnection(channelId, tokenType, token, ws);
      });

      console.log(`[ChannelConnectionPool] Added connection: channel=${channelId}, type=${tokenType}, token=${token.substring(0, 8)}..., total=${metrics.totalConnections}`);
      return true;

    } catch (error) {
      console.error('[ChannelConnectionPool] Error adding connection:', error);
      return false;
    }
  }

  /**
   * @returns {boolean} - ?쒓굅 ?깃났 ?щ?
   */
  removeConnection(channelId, tokenType, token, ws) {
    try {
      const channelPool = this.pools.get(channelId);
      if (!channelPool) return false;

      const typePool = channelPool.get(tokenType);
      if (!typePool) return false;

      const tokenConnections = typePool.get(token);
      if (!tokenConnections) return false;

      const removed = tokenConnections.delete(ws);
      if (removed) {
        const metrics = this.connectionMetrics.get(channelId);
        if (metrics) {
          metrics.totalConnections = Math.max(0, metrics.totalConnections - 1);
          metrics.lastActivity = Date.now();
        }

        console.log(`[ChannelConnectionPool] Removed connection: channel=${channelId}, type=${tokenType}, token=${token.substring(0, 8)}..., remaining=${metrics?.totalConnections || 0}`);
      }

      if (tokenConnections.size === 0) {
        typePool.delete(token);
        if (typePool.size === 0) {
          channelPool.delete(tokenType);
          if (channelPool.size === 0) {
            this.pools.delete(channelId);
            this.connectionMetrics.delete(channelId);
            console.log(`[ChannelConnectionPool] Cleaned up empty channel pool: ${channelId}`);
          }
        }
      }

      return removed;

    } catch (error) {
      console.error('[ChannelConnectionPool] Error removing connection:', error);
      return false;
    }
  }

  /**
   */
  getChannelConnections(channelId, tokenType = null) {
    const connections = new Set();
    const channelPool = this.pools.get(channelId);
    if (!channelPool) return connections;

    const typesToCheck = tokenType ? [tokenType] : Array.from(channelPool.keys());

    for (const type of typesToCheck) {
      const typePool = channelPool.get(type);
      if (typePool) {
        for (const tokenConnections of typePool.values()) {
          for (const ws of tokenConnections) {
            connections.add(ws);
          }
        }
      }
    }

    return connections;
  }

  /**
   */
  getChannelConnectionCount(channelId) {
    const metrics = this.connectionMetrics.get(channelId);
    return metrics ? metrics.totalConnections : 0;
  }

  /**
   */
  getTokenConnections(channelId, tokenType, token) {
    const channelPool = this.pools.get(channelId);
    if (!channelPool) return new Set();

    const typePool = channelPool.get(tokenType);
    if (!typePool) return new Set();

    return typePool.get(token) || new Set();
  }

  /**
   */
  async broadcastToChannel(channelId, tokenType, message) {
    try {
      const connections = this.getChannelConnections(channelId, tokenType);
      const messageStr = JSON.stringify(message);
      let sentCount = 0;

      for (const ws of connections) {
        try {
          if (ws.readyState === ws.OPEN) {
            ws.send(messageStr);
            sentCount++;
          }
        } catch (error) {
          console.warn('[ChannelConnectionPool] Failed to send message to connection:', error.message);
        }
      }

      console.log(`[ChannelConnectionPool] Broadcast to channel ${channelId} (${tokenType}): ${sentCount}/${connections.size} connections`);
      return sentCount;

    } catch (error) {
      console.error('[ChannelConnectionPool] Broadcast error:', error);
      return 0;
    }
  }

  /**
   */
  cleanupInactiveChannels() {
    const now = Date.now();
    const channelsToCleanup = [];

    for (const [channelId, metrics] of this.connectionMetrics.entries()) {
      if (metrics.totalConnections === 0 && (now - metrics.lastActivity) > this.inactiveThreshold) {
        channelsToCleanup.push(channelId);
      }
    }

    for (const channelId of channelsToCleanup) {
      this.pools.delete(channelId);
      this.connectionMetrics.delete(channelId);
      console.log(`[ChannelConnectionPool] Cleaned up inactive channel: ${channelId}`);
    }

    return channelsToCleanup.length;
  }

  /**
   */
  cleanupDeadConnections() {
    let cleanedCount = 0;

    for (const [channelId, channelPool] of this.pools.entries()) {
      for (const [tokenType, typePool] of channelPool.entries()) {
        for (const [token, connections] of typePool.entries()) {
          const deadConnections = [];

          for (const ws of connections) {
            if (ws.readyState === ws.CLOSED || ws.readyState === ws.CLOSING) {
              deadConnections.push(ws);
            }
          }

          for (const deadWs of deadConnections) {
            this.removeConnection(channelId, tokenType, token, deadWs);
            cleanedCount++;
          }
        }
      }
    }

    if (cleanedCount > 0) {
      console.log(`[ChannelConnectionPool] Cleaned up ${cleanedCount} dead connections`);
    }

    return cleanedCount;
  }

  /**
   */
  getPoolStatus() {
    const status = {
      totalChannels: this.pools.size,
      totalConnections: 0,
      channelDetails: [],
      timestamp: Date.now()
    };

    for (const [channelId, metrics] of this.connectionMetrics.entries()) {
      status.totalConnections += metrics.totalConnections;

      const channelPool = this.pools.get(channelId);
      const tokenTypes = channelPool ? Array.from(channelPool.keys()) : [];

      status.channelDetails.push({
        channelId,
        connections: metrics.totalConnections,
        tokenTypes,
        lastActivity: metrics.lastActivity,
        createdAt: metrics.createdAt,
        inactiveDuration: Date.now() - metrics.lastActivity
      });
    }

    status.channelDetails.sort((a, b) => b.connections - a.connections);

    return status;
  }

  /**
   *
   */
  startCleanupTimer() {
    setInterval(() => {
      try {
        const deadCount = this.cleanupDeadConnections();
        const inactiveCount = this.cleanupInactiveChannels();

        if (deadCount > 0 || inactiveCount > 0) {
          console.log(`[ChannelConnectionPool] Cleanup completed: ${deadCount} dead connections, ${inactiveCount} inactive channels`);
        }
      } catch (error) {
        console.error('[ChannelConnectionPool] Cleanup error:', error);
      }
    }, this.cleanupInterval);

    console.log(`[ChannelConnectionPool] Cleanup timer started (interval: ${this.cleanupInterval}ms)`);
  }

  /**
   */
  shutdown() {
    console.log('[ChannelConnectionPool] Shutting down...');

    for (const [channelId, channelPool] of this.pools.entries()) {
      for (const [tokenType, typePool] of channelPool.entries()) {
        for (const [token, connections] of typePool.entries()) {
          for (const ws of connections) {
            try {
              ws.close(1001, 'Server shutdown');
            } catch (error) {
              console.warn('[ChannelConnectionPool] Error closing connection during shutdown:', error.message);
            }
          }
        }
      }
    }

    //
    this.pools.clear();
    this.connectionMetrics.clear();

    console.log('[ChannelConnectionPool] Shutdown completed');
  }
}

const connectionPool = new ChannelConnectionPool({
  maxConnectionsPerChannel: 100,
  maxConnectionsPerToken: 10,
  cleanupInterval: 5 * 60 * 1000,
  inactiveThreshold: 30 * 60 * 1000
});

const channelRouletteConnections = new Map(); // channelId -> Map<token, Set<WebSocket>>
const channelPvdConnections = new Map(); // channelId -> Map<token, Set<WebSocket>>

// =============================
// Roulette Viewer (token-based, per-spin)
// =============================
const rouletteTokenSockets = new Map(); // token -> Set<WebSocket>
const rouletteTokenToSid = new Map(); // token -> sid
// Per-sid roulette queues to serialize spins
const rouletteQueues = new Map(); // sid -> Array<QueuedSpin>
const rouletteProcessing = new Set(); // sid currently processing
const ROULETTE_SPIN_MS = 5000; // must match viewer spin duration
const ROULETTE_EMPHASIS_MS = 1000; // final emphasis time in viewer
// Dedup map to avoid duplicate result chats if overlapping triggers happen
const rouletteLastResultSent = new Map(); // sid -> { key, at }
// Dedup map to avoid double-enqueue for the same command fired twice rapidly
const rouletteLastEnqueue = new Map(); // sid -> { key, at }
// Accumulator for multi-spin batches: key = sid|batchId -> { labels: string[], total: number, userForMsg: string, sessionKey, token }
const rouletteBatchAcc = new Map();
// Last batch meta per roulette token to augment WS payloads if needed
const rouletteTokenLastBatch = new Map(); // token -> { batchId: string, batchCount: number }

/**
 * Enqueue a roulette spin for a sid
 * item: { name, userId, username, chatPost?: { url, sessionKey, accessToken, resolvedUsername } }
 */
function enqueueRouletteSpin(sid, item) {
  // Prevent accidental double-enqueue within a small window (e.g., duplicate chat events)
  try {
    const batchId = String(item?.chatPost?.batchId || '');
    const inst = item?.instant === true ? '1' : '0';
    // Include batchId and instant in key so multi-spin enqueues are not collapsed
    const k = `${String(item?.username || '')}|${String(item?.userId || '')}|${String(item?.name || '')}|${batchId}|${inst}`;
    const last = rouletteLastEnqueue.get(sid);
    const now = Date.now();
    // For batch spins, skip dedup window entirely to allow rapid enqueue
    if (!batchId && last && last.key === k && (now - last.at) < 2000) {
      // skip enqueue
      return (rouletteQueues.get(sid) || []).length || 0;
    }
    rouletteLastEnqueue.set(sid, { key: k, at: now });
  } catch { }
  const q = rouletteQueues.get(sid) || [];
  q.push(item);
  const position = q.length;
  rouletteQueues.set(sid, q);
  if (!rouletteProcessing.has(sid)) {
    processRouletteQueue(sid).catch((e) => { console.warn('[Roulette Queue] Processor error', e?.message || e); });
  }
  return position;
}

function makeChzzkChatPost(sessionKey, accessToken, resolvedUsername, extra = {}) {
  return { provider: 'chzzk', sessionKey, accessToken, resolvedUsername, ...extra };
}

function makeCimeChatPost(ownerUserId, resolvedUsername, extra = {}) {
  return { provider: 'cime', ownerUserId, resolvedUsername, ...extra };
}

function rememberOutboundMessage(entry, text) {
  if (!entry) return;
  if (!(entry.recentOutboundMessages instanceof Map)) entry.recentOutboundMessages = new Map();
  const normalized = String(text || '').trim();
  if (!normalized) return;
  entry.recentOutboundMessages.set(normalized, Date.now());
  if (entry.recentOutboundMessages.size > 50) {
    let i = 0;
    for (const key of entry.recentOutboundMessages.keys()) {
      entry.recentOutboundMessages.delete(key);
      if (++i >= 10) break;
    }
  }
}

function hasRecentOutboundMessage(entry, text, windowMs = 2 * 60 * 1000) {
  const normalized = String(text || '').trim();
  if (!entry || !normalized || !(entry.recentOutboundMessages instanceof Map)) return false;
  const ts = Number(entry.recentOutboundMessages.get(normalized) || 0);
  return ts > 0 && Date.now() - ts < windowMs;
}

async function isLikelyChzzkBotSelfEcho(entry, sid, msg, ev, resolvedUserId) {
  const userId = String(resolvedUserId || msg?.senderChannelId || msg?.profile?.userId || ev?.id || '').trim();
  if (!userId) return false;
  const knownAruBotChannelId = '3e2835746563bde264f686303edc2a48';
  if (userId.toLowerCase() === knownAruBotChannelId) return true;
  if (!hasRecentOutboundMessage(entry, ev?.message || msg?.content || '')) return false;
  try {
    const owner = await getOwnerInfoForSid(sid);
    if (owner?.channelId && userId === String(owner.channelId)) return true;
    if (owner?.userId && userId === String(owner.userId)) return true;
  } catch { }
  return false;
}

async function sendChatByPost(sid, chatPost, message, opts = {}) {
  const text = String(message || '').trim();
  if (!text) return null;
  const provider = String(chatPost?.provider || 'chzzk').toLowerCase();
  if (provider === 'cime') {
    const ownerUserId = chatPost?.ownerUserId || String(sid || '').replace(/^user:/, '');
    return sendCimeChat(ownerUserId, text.slice(0, 100));
  }
  if (provider === 'youtube') {
    const ownerUserId = chatPost?.ownerUserId || String(sid || '').replace(/^user:/, '');
    return sendYoutubeChat(ownerUserId, chatPost?.liveChatId || null, text);
  }

  let sessionKey = chatPost?.sessionKey || null;
  let token = chatPost?.accessToken || null;
  if (!sessionKey) {
    try {
      const liveState = await refreshChzzkLiveStatusForSid(sid, { ttlMs: 5000 });
      if (!liveState.live) return null;
      const entry = sessionStore.get(sid) || await ensureSession(sid, liveState.channelId || undefined);
      sessionKey = entry?.sessionKey || null;
    } catch { }
  }
  if (!token) token = await getValidAccessToken(sid);
  if (!token) throw new Error('missing chat credentials');

  const url = `${OPENAPI_BASE}/open/v1/chats/send`;
  const request = {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: opts.timeout || 5000
  };
  let r;
  try {
    r = await axios.post(url, { message: text.slice(0, 100) }, request);
  } catch (e) {
    if (!sessionKey) throw e;
    r = await axios.post(url, { message: text.slice(0, 100) }, {
      ...request,
      params: { sessionKey }
    });
  }
  rememberOutboundMessage(sessionStore.get(sid), text.slice(0, 100));
  return r?.data?.content || r?.data || {};
}

async function processRouletteQueue(sid) {
  if (rouletteProcessing.has(sid)) return;
  rouletteProcessing.add(sid);
  try {
    while (true) {
      const q = rouletteQueues.get(sid) || [];
      const item = q.shift();
      if (!item) { rouletteQueues.set(sid, q); break; }
      rouletteQueues.set(sid, q);
      try {
        const started = await startRouletteSpin(
          sid,
          item.name,
          String(item.userId || ''),
          String(item.username || ''),
          {
            instant: item?.instant === true,
            batchId: item?.chatPost?.batchId || null,
            batchCount: Math.max(1, Number(item?.chatPost?.batchCount ?? 1)),
            chatPost: item?.chatPost || null,
            eventContext: item?.eventContext || null,
          }
        );
        // Strict serialization: wait for viewer animation; for instant items, use a very short delay
        const isInstant = item?.instant === true;
        const delayMs = isInstant ? 250 : (ROULETTE_SPIN_MS + ROULETTE_EMPHASIS_MS);
        await new Promise(r => setTimeout(r, delayMs));
        try {
          // Respect suppression flag for per-spin chat (used for multi-spin batching)
          const suppress = item?.chatPost?.suppressResultChat === true;
          if (!suppress) {
            // Use the exact result chosen for this spin to avoid mismatch with later spins
            const resultLabel = (started && started.result && (started.result.label || started.result.value)) ? (started.result.label || String(started.result.value)) : '';
            const userForMsg = ((item.chatPost && item.chatPost.resolvedUsername) || item.username || '').trim();

            let resultMsg = '';
            if (resultLabel) {
              resultMsg = `[룰렛] ${userForMsg}님의 결과: ${resultLabel}`;
            } else {
              resultMsg = `[룰렛] ${userForMsg}님의 실행에 실패했습니다.`;
            }

            // Deduplicate within a short window
            const dedupKey = `${userForMsg}|${resultLabel}`;
            const last = rouletteLastResultSent.get(sid);
            const nowTs = Date.now();

            if (!(last && last.key === dedupKey && (nowTs - last.at) < 3000)) {
              try {
                console.log('[Roulette Queue] Sending result chat:', resultMsg);
                await sendChatByPost(sid, item?.chatPost || {}, resultMsg, { timeout: 5000 });
                rouletteLastResultSent.set(sid, { key: dedupKey, at: Date.now() });
                console.log('[Roulette Queue] Result chat sent successfully');
              } catch (e) {
                console.error('[Roulette Queue] Failed to send result chat:', e?.response?.data || e?.message || e);
                try {
                  await sendChatByPost(sid, item?.chatPost || {}, '룰렛 결과 전송에 실패했습니다.', { timeout: 3000 });
                } catch (e2) {
                  console.error('[Roulette Queue] Failed to send error message:', e2);
                }
              }
            } else {
              console.log(`[Roulette Queue] Skipping duplicate result chat: ${dedupKey}`);
            }
          } else {
            console.log(`[Roulette Queue] Result chat suppressed for batch processing`);
          }
          // If part of a batch, collect and if finished, send combined result message(s)
          const batchId = item?.chatPost?.batchId || null;
          // Treat invalid/missing as 1; only accumulate when total >= 2
          const batchCount = Math.max(1, Number(item?.chatPost?.batchCount ?? 1));
          if (batchId && batchCount > 0) {
            const key = `${sid}|${String(batchId)}`;
            const rlabel = (started && started.result && (started.result.label || started.result.value)) ? String(started.result.label || String(started.result.value)) : '';
            let acc = rouletteBatchAcc.get(key);
            if (!acc) {
              acc = { labels: [], total: batchCount, userForMsg: ((item.chatPost && item.chatPost.resolvedUsername) || item.username || '').trim(), chatPost: item?.chatPost || {} };
              rouletteBatchAcc.set(key, acc);
            }
            acc.labels.push(rlabel);
            // Resolve access token lazily on send
            if (acc.total >= 2 && acc.labels.length >= acc.total) {
              // Build combined message and send in 100-char chunks
              const userForMsg = acc.userForMsg || '';
              const prefix = `[룰렛] ${userForMsg}님의 ${acc.total}회 결과: `;
              const joined = acc.labels.join(', ');
              const full = prefix + joined;

              console.log(`[Roulette Queue] Sending batch result for ${acc.total} spins: ${userForMsg}`);

              try {
                let i = 0;
                let chunkCount = 0;
                while (i < full.length) {
                  const part = full.slice(i, i + 100);
                  i += 100;
                  chunkCount++;
                  await sendChatByPost(sid, acc.chatPost || {}, part, { timeout: 5000 });
                  if (i < full.length) await new Promise(resolve => setTimeout(resolve, 200));
                }
                console.log('[Roulette Queue] Batch result sent in', chunkCount, 'chunks');
              } catch (e) {
                console.error('[Roulette Queue] Failed to send batch result:', e?.response?.data || e?.message || e);
              }
              rouletteBatchAcc.delete(key);
            }
          }
        } catch (e) {
          console.warn('[Roulette Queue] Failed to send result chat', e?.response?.data || e?.message || e);
        }
        // small gap
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        // proceed to next item even on error
        console.error('[Roulette Queue] Spin error (continuing)', e?.message || e);

        try {
          const userForMsg = ((item.chatPost && item.chatPost.resolvedUsername) || item.username || '').trim();
          let errorReason = '알 수 없는 오류';
          const errorMsg = e?.message || '';

          if (errorMsg.includes('roulette_not_found')) {
            errorReason = '룰렛을 찾을 수 없습니다.';
          } else if (errorMsg.includes('roulette_prob_sum_must_be_100')) {
            errorReason = '룰렛 확률 설정에 오류가 있습니다.';
          } else if (errorMsg.includes('schema cache') || errorMsg.includes('resultLabel')) {
            errorReason = '시스템 오류입니다. 잠시 후 다시 시도해 주세요.';
          } else if (errorMsg.includes('Network') || errorMsg.includes('timeout')) {
            errorReason = '네트워크 오류';
          } else if (errorMsg.includes('Database') || errorMsg.includes('connection')) {
            errorReason = '데이터베이스 연결 오류';
          }

          const finalErrorMsg = `[룰렛] ${userForMsg}님의 "${item.name}" 실행 실패: ${errorReason}`;

          await sendChatByPost(sid, item?.chatPost || {}, finalErrorMsg, { timeout: 3000 });
          console.log('[Roulette Queue] Error message sent:', finalErrorMsg);
        } catch (e2) {
          console.error('[Roulette Queue] Failed to send error message:', e2);
        }
      }
    }
  } finally {
    rouletteProcessing.delete(sid);
  }
}
function chooseRouletteItem(def) {
  if (!def || !Array.isArray(def.items) || def.items.length === 0) return { label: 'N/A', value: null };
  const type = String(def.type || 'items');
  const items = def.items.filter(it => it && typeof it.label === 'string');
  if (type === 'probability') {
    let totalPercent = 0;
    const probs = items.map(it => {
      const p = Number(it.probability || 0);
      totalPercent += p;
      return p / 100;
    });

    const tolerance = 0.001;
    if (Math.abs(totalPercent - 100) > tolerance) {
      const error = totalPercent > 100 ?
        `확률 합계가 ${totalPercent.toFixed(4)}%로 ${(totalPercent - 100).toFixed(4)}% 초과합니다. 정확히 100%가 되도록 조정해 주세요.` :
        `확률 합계가 ${totalPercent.toFixed(4)}%로 ${(100 - totalPercent).toFixed(4)}% 부족합니다. 정확히 100%가 되도록 조정해 주세요.`;
      throw new Error(error);
    }

    // Normalize probability values.
    const total = probs.reduce((sum, p) => sum + p, 0);
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      if ((r -= probs[i]) <= 0) return { label: items[i].label, value: items[i].value ?? null };
    }
    return { label: items[items.length - 1].label, value: items[items.length - 1].value ?? null };
  }
  // items/weights
  let sum = 0;
  const weights = items.map(it => { const w = Math.max(0, Number(it.weight || 0)); sum += w; return w; });
  if (sum <= 0) return { label: items[0].label, value: items[0].value ?? null };
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    if ((r -= weights[i]) <= 0) return { label: items[i].label, value: items[i].value ?? null };
  }
  return { label: items[items.length - 1].label, value: items[items.length - 1].value ?? null };
}

// Parse ISO8601 duration (e.g., PT1H2M10S) to seconds
function parseIso8601Duration(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = Number(m[1] || 0), mm = Number(m[2] || 0), s = Number(m[3] || 0);
  return h * 3600 + mm * 60 + s;
}

// Helper: extract YouTube video id from various URL forms
function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
    if (u.hostname.endsWith('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{6,})/);
      if (m) return m[1];
      const m2 = u.pathname.match(/^\/embed\/([A-Za-z0-9_-]{6,})/);
      if (m2) return m2[1];
    }
  } catch { }
  // fallback: if user provided plain id
  if (/^[A-Za-z0-9_-]{6,}$/.test(String(url || ''))) return String(url);
  return null;
}

// Fetch YouTube title and durationSec using Data API v3 when available
async function fetchYouTubeInfo(videoIdOrUrl) {
  try {
    const id = extractYouTubeId(videoIdOrUrl) || String(videoIdOrUrl);
    if (!id) return { title: null, durationSec: null };
    let title = null;
    let durationSec = null;

    // 1) Try YouTube Data API v3 if API key is configured
    if (YT_API_KEY) {
      try {
        const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${encodeURIComponent(id)}&key=${encodeURIComponent(YT_API_KEY)}`;
        const r = await axios.get(url, { timeout: 5000 });
        const item = Array.isArray(r?.data?.items) && r.data.items.length ? r.data.items[0] : null;
        if (item) {
          title = item?.snippet?.title || title;
          const durationIso = item?.contentDetails?.duration || null;
          durationSec = durationIso ? parseIso8601Duration(durationIso) : durationSec;
        }
      } catch { }
    }

    // 2) Fallback to oEmbed (title only)
    if (!title) {
      try {
        const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
        const r = await axios.get(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`, { timeout: 7000 });
        title = r?.data?.title || title;
      } catch { }
    }

    // 3) Final fallback: fetch watch page and parse <title>
    if (!title) {
      try {
        const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
        const r = await axios.get(watchUrl, { timeout: 7000, responseType: 'text' });
        const html = String(r?.data || '');
        const m = html.match(/<title>([^<]+)<\/title>/i);
        if (m && m[1]) {
          title = m[1].replace(/\s*-\s*YouTube\s*$/i, '').trim();
        }
      } catch { }
    }

    return { title: title || null, durationSec };
  } catch {
    return { title: null, durationSec: null };
  }
}

// Search YouTube by text query and return best matching videoId
async function searchYouTubeVideoIdByQuery(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  // Prefer YouTube Data API v3 if API key exists (more reliable)
  if (YT_API_KEY) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&order=relevance&regionCode=KR&relevanceLanguage=ko&q=${encodeURIComponent(q)}&key=${encodeURIComponent(YT_API_KEY)}`;
      const r = await axios.get(url, { timeout: 5000, headers: { 'Accept-Language': 'ko-KR,ko;q=0.9' } });
      const item = Array.isArray(r?.data?.items) && r.data.items.length ? r.data.items[0] : null;
      const vid = item?.id?.videoId || null;
      if (vid) return String(vid);
    } catch { /* fall through to scrape */ }
  }
  // Fallback: scrape YouTube search results page
  try {
    const searchUrl = `https://www.youtube.com/results?hl=ko&gl=KR&search_query=${encodeURIComponent(q)}`;
    const r = await axios.get(searchUrl, { timeout: 7000, responseType: 'text', headers: { 'Accept-Language': 'ko-KR,ko;q=0.9' } });
    const html = String(r?.data || '');
    // Try to find "videoId":"<id>"
    const m1 = html.match(/\bvideoId\":\"([a-zA-Z0-9_-]{11})\"/);
    if (m1 && m1[1]) return m1[1];
    // Fallback: find first watch?v=ID pattern
    const m2 = html.match(/watch\?v=([a-zA-Z0-9_-]{11})/);
    if (m2 && m2[1]) return m2[1];
  } catch { }
  return null;
}

// Public: control by token (viewer may request sync operations)
app.post('/api/video-donation/control-by-token', async (req, res) => {
  try {
    const token = String(req.body?.token || '');
    if (!token) return res.status(400).json({ error: 'token required' });
    let sid = pvdTokenToSid.get(token) || null;
    if (!sid) {
      try { sid = await findSidByViewerToken(token); if (sid) pvdTokenToSid.set(token, sid); } catch { }
    }
    if (!sid) return res.status(404).json({ error: 'token not found' });
    // Verify current token
    let settings = {};
    try {
      settings = await getBotSettings(sid) || {};
      if (!settings.videoDonationViewerToken || settings.videoDonationViewerToken !== token) return res.status(404).json({ error: 'token not found' });
    } catch { }
    const op = String(req.body?.op || '').toLowerCase();
    if (op === 'volume') {
      const volume = normalizePvdVolume(req.body?.volume ?? req.body?.value ?? 100);
      await setBotSettings(sid, { ...settings, videoDonationVolume: volume });
      const message = await broadcastPvdControl(sid, { op, volume });
      return res.json({ ok: true, message });
    }
    const q = getVideoQueue(sid);
    if (!q[0]) return res.json({ ok: true });
    if (op === 'duration' || op === 'duration_sync') {
      const durationSec = Number(req.body?.durationSec ?? req.body?.duration ?? req.body?.value);
      const item = updateCurrentPvdDurationFromPlayer(sid, durationSec);
      if (!item) return res.status(400).json({ error: 'invalid duration' });
      return res.json({ ok: true, item });
    }
    let atSec = Number(req.body?.atSec);
    if (!Number.isFinite(atSec) || atSec < 0) atSec = getCurrentAtSec(sid);
    let state = pvdPlaybackState.get(sid);
    if (!state) { state = createPvdPlaybackState(q[0]); pvdPlaybackState.set(sid, state); }
    if (op === 'pause') {
      state.paused = true; state.pausedAtSec = Math.floor(atSec);
    } else if (op === 'play') {
      state.paused = false; setPvdPlaybackBaseFromAtSec(state, q[0], atSec); state.pausedAtSec = null;
    } else if (op === 'seek') {
      if (state.paused) { state.pausedAtSec = Math.floor(atSec); }
      else { setPvdPlaybackBaseFromAtSec(state, q[0], atSec); }
    } else {
      return res.status(400).json({ error: 'invalid op' });
    }
    // Reschedule auto-pop based on new state/time
    try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
    scheduleNextPvdAutoPop(sid);

    const message = await broadcastPvdControl(sid, { op, atSec: Math.floor(atSec), paused: state.paused === true });
    return res.json({ ok: true, message });
  } catch (e) {
    return res.status(500).json({ error: 'failed' });
  }
});

// ---- Macros: CRUD and background runner ----
// GET macros
app.get('/api/macros', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const s = await getBotSettings(sid) || {};
    const macros = Array.isArray(s.macros) ? s.macros : [];
    return res.json({ macros });
  } catch { return res.status(500).json({ error: 'failed' }); }
});

// UPSERT macro
app.post('/api/macros/upsert', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const s = await getBotSettings(sid) || {};
    const incoming = req.body?.macro || {};
    if (!incoming.message || !Number.isFinite(Number(incoming.intervalSec))) {
      return res.status(400).json({ error: 'invalid payload' });
    }
    const macros = Array.isArray(s.macros) ? s.macros.slice() : [];
    let idx = macros.findIndex(m => String(m.id || '') === String(incoming.id || ''));
    if (idx < 0) {
      incoming.id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      incoming.enabled = incoming.enabled !== false;
      incoming.intervalSec = Math.max(1, Number(incoming.intervalSec));
      incoming.message = String(incoming.message || '').slice(0, 1000);
      macros.push(incoming);
    } else {
      macros[idx] = {
        ...macros[idx],
        enabled: incoming.enabled !== false,
        intervalSec: Math.max(1, Number(incoming.intervalSec)),
        message: String(incoming.message || '').slice(0, 1000),
        id: macros[idx].id,
      };
      incoming.id = macros[idx].id;
    }
    const next = { ...s, macros };
    await setBotSettings(sid, next);
    // mark cache dirty
    try { macroCache.delete(sid); } catch { }
    return res.json({ ok: true, macro: incoming });
  } catch { return res.status(500).json({ error: 'failed' }); }
});

// DELETE macro
app.post('/api/macros/delete', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const id = String(req.body?.id || '');
    const s = await getBotSettings(sid) || {};
    const macros = (Array.isArray(s.macros) ? s.macros : []).filter(m => String(m.id || '') !== id);
    const next = { ...s, macros };
    await setBotSettings(sid, next);
    try { macroCache.delete(sid); } catch { }
    return res.json({ ok: true });
  } catch { return res.status(500).json({ error: 'failed' }); }
});

// GET macro timer debug info
app.get('/api/macros/debug', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const debugInfo = macroTimerManager.getDebugInfo(sid);
    const liveStatus = await getLiveStatusDebugInfo(sid);

    return res.json({
      macroTimers: debugInfo,
      liveStatus: liveStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

// POST reset macro timers (for testing/debugging)
app.post('/api/macros/reset-timers', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const macroId = req.body?.macroId;

    if (macroId) {
      // Reset specific macro timer
      const sidTimers = macroTimerManager.macroTimers.get(sid);
      if (sidTimers && sidTimers.has(macroId)) {
        sidTimers.delete(macroId);
        console.log(`Reset timer for macro: sid=${sid}, macroId=${macroId}`);
      }
    } else {
      // Reset all macro timers for this sid
      macroTimerManager.macroTimers.delete(sid);
      console.log(`Reset all macro timers for sid: ${sid}`);
    }

    return res.json({ ok: true, message: macroId ? `Timer reset for macro ${macroId}` : 'All timers reset' });
  } catch (error) {
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

// GET performance monitoring report
app.get('/api/macros/performance', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const report = performanceMonitor.getPerformanceReport(sid);
    return res.json(report);
  } catch (error) {
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

// GET system-wide performance report (admin only)
app.get('/api/macros/performance/system', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    // For now, allow any authenticated user to see system stats
    // In production, you might want to add admin role checking
    const report = performanceMonitor.getPerformanceReport();

    // Add cache size information
    report.cacheInfo = {
      macroCache: macroCache.size,
      liveCache: liveCache.size,
      timerCache: macroTimerManager.macroTimers.size,
      maxSizes: cacheManager.maxCacheSize
    };

    return res.json(report);
  } catch (error) {
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

// POST trigger cache cleanup (admin/debugging)
app.post('/api/macros/cleanup', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const { type } = req.body; // 'cache', 'sessions', 'all'

    let results = {};

    if (type === 'cache' || type === 'all') {
      results.cacheCleanup = cacheManager.performFullCleanup();
    }

    if (type === 'sessions' || type === 'all') {
      cleanupInactiveSessions();
      results.sessionCleanup = 'completed';
    }

    if (type === 'metrics' || type === 'all') {
      performanceMonitor.cleanupStaleMetrics();
      results.metricsCleanup = 'completed';
    }

    return res.json({
      ok: true,
      message: `Cleanup completed for: ${type}`,
      results
    });
  } catch (error) {
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

app.get('/api/attendance/performance', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const report = performanceMonitor.getPerformanceReport();

    const attendanceMetrics = {
      dbMetrics: report.dbMetrics,
      cacheMetrics: {
        hitRates: Object.fromEntries(
          Object.entries(report.cacheMetrics.hitRates)
            .filter(([key]) => key.includes('attendance') || key.includes('session'))
        )
      },
      errorCounts: Object.fromEntries(
        Object.entries(report.errorCounts)
          .filter(([key]) => key.includes('attendance') || key.includes('session') || key.includes('db'))
      ),
      sessionInfo: {
        activeSessions: liveSession.size,
        liveStatusCache: liveStatusCache.size,
        attendanceDedupe: attendanceDedupe.size
      },
      timestamp: report.timestamp
    };

    return res.json(attendanceMetrics);
  } catch (error) {
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

app.post('/api/attendance/validate-sessions', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const { targetSid } = req.body;
    const sidsToValidate = targetSid ? [targetSid] : [sid];

    const results = [];

    for (const validateSid of sidsToValidate) {
      const startTime = Date.now();
      try {
        await validateAndRecoverSessionState(validateSid);
        results.push({
          sid: validateSid,
          success: true,
          duration: Date.now() - startTime
        });
      } catch (error) {
        results.push({
          sid: validateSid,
          success: false,
          duration: Date.now() - startTime,
          error: error.message
        });
      }
    }

    return res.json({
      ok: true,
      results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

app.get('/api/memory/report', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const report = memoryManager.getMemoryReport();
    return res.json(report);
  } catch (error) {
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

app.post('/api/memory/cleanup', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const { force = false } = req.body;

    const result = memoryManager.performMemoryCleanup(force);

    return res.json({
      ok: true,
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

app.post('/api/privacy/retention-cleanup', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const result = await cleanupPrivacyRetentionData(req.body || {});
    return res.json({
      ok: result.ok !== false,
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Privacy] Retention cleanup API failed:', error?.message || error);
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

app.get('/api/memory/sessions', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const sessions = Array.from(liveSession.entries()).map(([sessionSid, session]) => ({
      sid: sessionSid,
      live: session.live,
      startDate: session.startDate,
      lastUpdate: session.lastUpdate,
      ageMinutes: Math.round((Date.now() - session.lastUpdate) / (1000 * 60))
    }));

    const stats = {
      total: sessions.length,
      active: sessions.filter(s => s.live).length,
      inactive: sessions.filter(s => !s.live).length,
      oldSessions: sessions.filter(s => s.ageMinutes > 60).length,
      veryOldSessions: sessions.filter(s => s.ageMinutes > 1440).length
    };

    return res.json({
      sessions: sessions.slice(0, 100),
      stats,
      limits: MEMORY_LIMITS,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

app.get('/api/memory/channel-cache', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(400).json({ error: 'Channel context not found' });
    }

    const channelMetrics = channelCache.getMetrics(channelContext.channelId);
    const overallMetrics = channelCache.getMetrics();

    return res.json({
      ok: true,
      channelId: channelContext.channelId,
      channelMetrics,
      overallMetrics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API] Channel cache metrics error:', error);
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

app.get('/api/memory/connection-pool', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(400).json({ error: 'Channel context not found' });
    }

    const poolStatus = connectionPool.getPoolStatus();
    const channelStats = getChannelConnectionStats(channelContext.channelId);

    return res.json({
      ok: true,
      channelId: channelContext.channelId,
      channelStats,
      poolStatus,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API] Connection pool status error:', error);
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

app.post('/api/memory/channel-cache/cleanup', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const { channelId, clearAll = false } = req.body;

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(400).json({ error: 'Channel context not found' });
    }

    let result = {};

    if (clearAll) {
      channelCache.clear();
      result.message = 'All cache cleared';
    } else {
      const targetChannelId = channelId || channelContext.channelId;
      const deleted = channelCache.delete(targetChannelId);
      result.message = deleted ? `Channel cache cleared: ${targetChannelId}` : 'No cache found';
      result.channelId = targetChannelId;
    }

    return res.json({
      ok: true,
      result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API] Cache cleanup error:', error);
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

//
app.get('/api/memory/resource-stats', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const statistics = resourceManager.getStatistics();

    return res.json({
      ok: true,
      statistics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API] Resource statistics error:', error);
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

//
app.post('/api/memory/resource-cleanup', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const { force = false, type = 'full' } = req.body;

    let result = {};

    switch (type) {
      case 'channels':
        result = await resourceManager.cleanupInactiveChannels();
        break;
      case 'tokens':
        result = await resourceManager.cleanupExpiredTokens();
        break;
      case 'sessions':
        result = await resourceManager.cleanupExpiredSessions();
        break;
      case 'full':
      default:
        result = await resourceManager.performFullCleanup(force);
        break;
    }

    return res.json({
      ok: true,
      type,
      force,
      result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API] Resource cleanup error:', error);
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

app.get('/api/memory/usage-detail', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const memoryUsage = resourceManager.getMemoryUsage();
    const poolStatus = connectionPool.getPoolStatus();
    const cacheMetrics = channelCache.getMetrics();

    const channelContext = await getChannelContext(sid);
    const userChannelStats = channelContext ? {
      channelId: channelContext.channelId,
      cacheMetrics: channelCache.getMetrics(channelContext.channelId),
      connectionCount: connectionPool.getChannelConnectionCount(channelContext.channelId)
    } : null;

    return res.json({
      ok: true,
      memoryUsage,
      poolStatus,
      cacheMetrics,
      userChannelStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API] Memory usage detail error:', error);
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

app.get('/api/debug/token-validation', requireOpsAuth, async (req, res) => {
  try {
    const { token, type } = req.query;

    if (!token || !type) {
      return res.status(400).json({
        error: 'Missing parameters',
        required: ['token', 'type'],
        provided: { token: !!token, type: !!type }
      });
    }

    const debugInfo = {
      token: token.substring(0, 8) + '...',
      type,
      timestamp: new Date().toISOString(),
      validation: {}
    };

    try {
      if (!token || typeof token !== 'string' || token.length < 8) {
        debugInfo.validation.format = { valid: false, error: 'Invalid token format' };
      } else {
        debugInfo.validation.format = { valid: true };
      }

      let sid = null;
      if (type === 'roulette') {
        sid = rouletteTokenToSid.get(token);
        debugInfo.validation.memoryCache = {
          found: !!sid,
          sid: sid || null,
          cacheSize: rouletteTokenToSid.size
        };
      } else if (type === 'pvd') {
        sid = pvdTokenToSid.get(token);
        debugInfo.validation.memoryCache = {
          found: !!sid,
          sid: sid || null,
          cacheSize: pvdTokenToSid.size
        };
      }

      //
      if (!sid) {
        try {
          if (type === 'roulette') {
            sid = await findSidByRouletteToken(token);
          } else if (type === 'pvd') {
            sid = await findSidByViewerToken(token);
          }
          debugInfo.validation.database = {
            found: !!sid,
            sid: sid || null
          };
        } catch (dbError) {
          debugInfo.validation.database = {
            found: false,
            error: dbError.message
          };
        }
      }

      if (sid && type === 'pvd') {
        try {
          const settings = await getBotSettings(sid);
          const currentToken = settings?.videoDonationViewerToken;
          debugInfo.validation.settings = {
            hasSettings: !!settings,
            hasToken: !!currentToken,
            tokenMatch: currentToken === token,
            currentTokenPrefix: currentToken ? currentToken.substring(0, 8) + '...' : null
          };
        } catch (settingsError) {
          debugInfo.validation.settings = {
            error: settingsError.message
          };
        }
      }

      if (sid) {
        try {
          const channelContext = await getChannelContext(sid);
          debugInfo.validation.channelContext = {
            found: !!channelContext,
            channelId: channelContext?.channelId || null,
            userId: channelContext?.userId || null
          };
        } catch (contextError) {
          debugInfo.validation.channelContext = {
            error: contextError.message
          };
        }
      }
    } catch (e) { console.error(e) }
    return res.json(debugInfo);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'failed' });
  }
})

const macroCache = new Map(); // sid -> { macros, fetchedAt }
const macroLastSent = new Map(); // sid -> Map(macroId -> ts)
const liveCache = new Map(); // sid -> { live: boolean, checkedAt }

// Simplified macro logging system
class MacroLogger {
  constructor() {
    this.isDebugMode = process.env.NODE_ENV === 'development' || process.env.MACRO_DEBUG === 'true';
  }

  // Empty methods to maintain compatibility but remove console output
  logMacroSent(sid, macroId, message, details = {}) {
    // No console output
  }

  logMacroSkipped(sid, macroId, reason, errorDetails = {}) {
    // No console output
  }

  logLiveStatusChange(sid, oldStatus, newStatus, context = {}) {
    // No console output
  }

  logCacheRefresh(sid, type, operation, details = {}) {
    // No console output
  }

  logTimerDetails(sid, timerInfo) {
    // No console output
  }

  logExecutionCycle(sid, cycleStats) {
    // No console output
  }
}

// =============================
// =============================

/**
 *
 *
 *
 */
function logSessionStateChange(sid, oldState, newState, source, context = {}) {
  const timestamp = new Date().toISOString();
  const oldStateStr = oldState ? JSON.stringify({
    live: oldState.live,
    startDate: oldState.startDate || oldState.start_date,
    lastUpdate: oldState.lastUpdate || oldState.last_update
  }) : 'null';
  const newStateStr = newState ? JSON.stringify({
    live: newState.live,
    startDate: newState.startDate || newState.start_date,
    lastUpdate: newState.lastUpdate || newState.last_update
  }) : 'null';

  console.log(`[Session-State] ${sid}: ${oldStateStr} -> ${newStateStr} [source: ${source}] [context: ${JSON.stringify(context)}] [${timestamp}]`);
}

/**
 *
 * @param {string} dateSource - ?좎쭨 ?뚯뒪 (memory, database, current_kst, emergency)
 *
 */
function logAttendanceAttempt(sid, userId, username, date, result, dateSource, context = {}) {
  const timestamp = new Date().toISOString();
  const resultStr = result ? `streak=${result.streak}, isNew=${result.isNew}, totalDays=${result.totalDays || 'unknown'}` : 'failed';

  console.log(`[Attendance] ${sid}:${userId}(${username}) on ${date} -> ${resultStr} [dateSource: ${dateSource}] [context: ${JSON.stringify(context)}] [${timestamp}]`);
}

/**
 *
 *
 * @param {boolean} success - ?깃났 ?щ?
 * @param {number} duration - ?묒뾽 ?뚯슂 ?쒓컙 (ms)
 *
 *
 */
function logDBOperation(operation, table, sid, success, duration, error = null, context = {}) {
  const timestamp = new Date().toISOString();
  const sidStr = sid ? ` sid=${sid}` : '';
  const durationStr = Number.isFinite(duration) ? ` (${duration}ms)` : '';

  if (Number.isFinite(duration)) {
    performanceMonitor.recordDBResponseTime(`${operation}_${table}`, duration, success);
  }

  if (!success) {
    const errorType = error?.code || error?.name || 'unknown_db_error';
    performanceMonitor.recordError(`db_${errorType}`, sid);
  }

  if (success) {
    console.log(`[DB-${operation.toUpperCase()}] ${table}${sidStr} -> SUCCESS${durationStr} [context: ${JSON.stringify(context)}] [${timestamp}]`);
  } else {
    const errorStr = error ? ` error=${error.message || error}` : '';
    console.error(`[DB-${operation.toUpperCase()}] ${table}${sidStr} -> FAILED${durationStr}${errorStr} [context: ${JSON.stringify(context)}] [${timestamp}]`);
  }
}

/**
 *
 *
 *
 */
function logCacheDBMismatch(sid, type, cacheData, dbData, action) {
  const timestamp = new Date().toISOString();
  const cacheStr = cacheData ? JSON.stringify(cacheData) : 'null';
  const dbStr = dbData ? JSON.stringify(dbData) : 'null';

  console.warn(`[Cache-DB-Mismatch] ${sid} ${type}: cache=${cacheStr}, db=${dbStr} -> action=${action} [${timestamp}]`);
}

/**
 */
function logPerformanceMetrics(operation, sid, metrics) {
  const timestamp = new Date().toISOString();
  const sidStr = sid ? ` sid=${sid}` : '';

  if (typeof metrics.cacheHit === 'boolean') {
    performanceMonitor.recordCacheHit(operation, metrics.cacheHit);
  }

  if (metrics.error) {
    performanceMonitor.recordError(`${operation}_error`, sid);
  }
}

// =============================
// =============================

/**
 *
 *
 *
 */
function handleDBConnectionFailure(sid, operation, error) {
  const timestamp = new Date().toISOString();

  console.error(`[DB-Failure] ${operation} failed for ${sid}: ${error.message} [${timestamp}]`);

  const cachedSession = liveSession.get(sid);
  if (cachedSession && operation.includes('session')) {
    console.warn(`[DB-Failure] Using cache fallback for ${sid}: ${JSON.stringify(cachedSession)} [${timestamp}]`);
    return cachedSession;
  }

  const defaultState = {
    live: false,
    startDate: undefined,
    sessionStartTime: undefined,
    lastUpdate: Date.now()
  };

  console.warn(`[DB-Failure] Using default fallback for ${sid}: ${JSON.stringify(defaultState)} [${timestamp}]`);
  return defaultState;
}

/**
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map(); // sid -> metrics
    this.systemMetrics = {
      dbResponseTimes: [],
      cacheHitRates: new Map(), // operation -> { hits, total }
      errorCounts: new Map(), // errorType -> count
      lastCleanup: Date.now()
    };
  }

  /**
   * @param {number} duration - ?뚯슂 ?쒓컙 (ms)
   * @param {boolean} success - ?깃났 ?щ?
   */
  recordDBResponseTime(operation, duration, success) {
    this.systemMetrics.dbResponseTimes.push({
      operation,
      duration,
      success,
      timestamp: Date.now()
    });

    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    this.systemMetrics.dbResponseTimes = this.systemMetrics.dbResponseTimes
      .filter(metric => metric.timestamp > oneHourAgo);
  }

  /**
   */
  recordCacheHit(operation, hit) {
    if (!this.systemMetrics.cacheHitRates.has(operation)) {
      this.systemMetrics.cacheHitRates.set(operation, { hits: 0, total: 0 });
    }

    const stats = this.systemMetrics.cacheHitRates.get(operation);
    stats.total++;
    if (hit) stats.hits++;
  }

  /**
   */
  recordCacheOperation(cacheType, isHit) {
    this.recordCacheHit(cacheType, isHit);
  }

  /**
   */
  recordError(errorType, sid = null) {
    const key = sid ? `${errorType}:${sid}` : errorType;
    const current = this.systemMetrics.errorCounts.get(key) || 0;
    this.systemMetrics.errorCounts.set(key, current + 1);
  }

  /**
   *
   *
   */
  getPerformanceReport(sid = null) {
    const now = Date.now();

    if (sid) {
      const sidMetrics = this.metrics.get(sid) || {};
      return {
        sid,
        metrics: sidMetrics,
        sessionDetails: this.getSessionDetails(sid),
        timestamp: new Date().toISOString()
      };
    }

    const recentDBMetrics = this.systemMetrics.dbResponseTimes
      .filter(m => (now - m.timestamp) < (30 * 60 * 1000));

    const avgResponseTime = recentDBMetrics.length > 0
      ? recentDBMetrics.reduce((sum, m) => sum + m.duration, 0) / recentDBMetrics.length
      : 0;

    const successRate = recentDBMetrics.length > 0
      ? recentDBMetrics.filter(m => m.success).length / recentDBMetrics.length
      : 1;

    const cacheHitRates = {};
    for (const [operation, stats] of this.systemMetrics.cacheHitRates) {
      cacheHitRates[operation] = stats.total > 0 ? (stats.hits / stats.total) : 0;
    }

    const memoryStats = this.getMemoryStats();

    // ?몄뀡 ?듦퀎
    const sessionStats = this.getSessionStats();

    return {
      system: true,
      timestamp: new Date().toISOString(),
      dbMetrics: {
        avgResponseTime: Math.round(avgResponseTime * 100) / 100,
        successRate: Math.round(successRate * 10000) / 100,
        totalQueries: recentDBMetrics.length
      },
      cacheMetrics: {
        hitRates: cacheHitRates,
        totalOperations: Array.from(this.systemMetrics.cacheHitRates.values())
          .reduce((sum, stats) => sum + stats.total, 0)
      },
      memoryUsage: memoryStats,
      sessionStats: sessionStats,
      errorCounts: Object.fromEntries(this.systemMetrics.errorCounts)
    };
  }

  /**
   */
  getMemoryStats() {
    if (!this.systemMetrics.memoryUsage || this.systemMetrics.memoryUsage.length === 0) {
      return null;
    }

    const latest = this.systemMetrics.memoryUsage[this.systemMetrics.memoryUsage.length - 1];
    const oldest = this.systemMetrics.memoryUsage[0];

    return {
      current: {
        heapUsed: Math.round(latest.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(latest.heapTotal / 1024 / 1024), // MB
        rss: Math.round(latest.rss / 1024 / 1024) // MB
      },
      trend: this.systemMetrics.memoryUsage.length > 1 ? {
        heapUsedChange: latest.heapUsed - oldest.heapUsed,
        timeSpan: latest.timestamp - oldest.timestamp
      } : null
    };
  }

  /**
   *
   * @returns {Object} ?몄뀡 ?듦퀎
   */
  getSessionStats() {
    const now = Date.now();
    const activeSessions = [];
    const inactiveSessions = [];

    for (const [sid, sidMetrics] of this.metrics.entries()) {
      const inactiveTime = now - sidMetrics.sessionActivity;
      const sessionInfo = {
        sid,
        lastActivity: new Date(sidMetrics.sessionActivity).toISOString(),
        inactiveTime: Math.round(inactiveTime / 1000), // seconds
        executionCount: sidMetrics.macroExecutionTimes?.length || 0
      };

      if (inactiveTime < 30 * 60 * 1000) {
        activeSessions.push(sessionInfo);
      } else {
        inactiveSessions.push(sessionInfo);
      }
    }

    return {
      activeSessions: activeSessions.length,
      inactiveSessions: inactiveSessions.length,
      sessions: {
        active: activeSessions.slice(0, 10),
        inactive: inactiveSessions.slice(0, 5)
      }
    };
  }

  /**
   * @param {string} sid - ?몄뀡 ID
   * @param {number} executionTime - ?ㅽ뻾 ?쒓컙 (ms)
   * @param {Object} stats - ?ㅽ뻾 ?듦퀎
   */
  recordMacroExecution(sid, executionTime, stats) {
    if (!this.metrics.has(sid)) {
      this.metrics.set(sid, {
        macroExecutionTimes: [],
        sessionActivity: Date.now(),
        errorRates: new Map()
      });
    }

    const sidMetrics = this.metrics.get(sid);
    sidMetrics.macroExecutionTimes.push({
      timestamp: Date.now(),
      executionTime,
      macrosSent: stats.macrosSent,
      macrosFailed: stats.macrosFailed,
      macrosSkipped: stats.macrosSkipped
    });

    if (sidMetrics.macroExecutionTimes.length > 50) {
      sidMetrics.macroExecutionTimes.splice(0, sidMetrics.macroExecutionTimes.length - 50);
    }

    sidMetrics.sessionActivity = Date.now();
  }

  /**
   */
  recordMemoryUsage() {
    const usage = process.memoryUsage();
    if (!this.systemMetrics.memoryUsage) {
      this.systemMetrics.memoryUsage = [];
    }

    this.systemMetrics.memoryUsage.push({
      timestamp: Date.now(),
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss
    });

    if (this.systemMetrics.memoryUsage.length > 100) {
      this.systemMetrics.memoryUsage.splice(0, this.systemMetrics.memoryUsage.length - 100);
    }
  }

  /**
   *
   * @param {string} sid - ?몄뀡 ID
   * @returns {Object|null} ?몄뀡 ?곸꽭 ?뺣낫
   */
  getSessionDetails(sid) {
    const sidMetrics = this.metrics.get(sid);
    if (!sidMetrics || !sidMetrics.macroExecutionTimes.length) return null;

    const times = sidMetrics.macroExecutionTimes.map(e => e.executionTime);
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);

    const recentExecutions = sidMetrics.macroExecutionTimes.slice(-10);

    return {
      averageExecutionTime: Math.round(avgTime),
      maxExecutionTime: maxTime,
      minExecutionTime: minTime,
      totalExecutions: sidMetrics.macroExecutionTimes.length,
      recentExecutions: recentExecutions.map(e => ({
        timestamp: new Date(e.timestamp).toISOString(),
        executionTime: e.executionTime,
        macrosSent: e.macrosSent,
        macrosFailed: e.macrosFailed
      }))
    };
  }

  /**
   */
  cleanupStaleMetrics() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    const staleThreshold = 2 * 60 * 60 * 1000; // 2?쒓컙
    let cleanedCount = 0;

    this.systemMetrics.dbResponseTimes = this.systemMetrics.dbResponseTimes
      .filter(metric => metric.timestamp > oneHourAgo);

    if (this.systemMetrics.memoryUsage) {
      this.systemMetrics.memoryUsage = this.systemMetrics.memoryUsage
        .filter(metric => metric.timestamp > oneHourAgo);
    }

    for (const [sid, sidMetrics] of this.metrics.entries()) {
      if (now - sidMetrics.sessionActivity > staleThreshold) {
        this.metrics.delete(sid);
        cleanedCount++;
      }
    }

    if (now - this.systemMetrics.lastCleanup > (24 * 60 * 60 * 1000)) {
      this.systemMetrics.errorCounts.clear();
      this.systemMetrics.lastCleanup = now;
    }

    if (cleanedCount > 0) {
      console.log(`[PERF-CLEANUP] Cleaned up metrics for ${cleanedCount} stale sessions`);
    }
  }
}

const performanceMonitor = new PerformanceMonitor();

// Enhanced macro timer management for independence
class MacroTimerManager {
  constructor() {
    this.macroTimers = new Map(); // sid -> Map(macroId -> lastSentTimestamp)
    this.failureCount = new Map(); // sid -> Map(macroId -> consecutive failure count)
    this.lastFailureTime = new Map(); // sid -> Map(macroId -> last failure timestamp)
    this.logger = new MacroLogger();
  }

  /**
   * Check if a macro should be sent based on its individual timer
   * @param {string} sid - Session ID
   * @param {string} macroId - Macro ID
   * @param {number} intervalSec - Macro interval in seconds
   * @returns {boolean} - Whether the macro should be sent
   */
  shouldSendMacro(sid, macroId, intervalSec) {
    if (!sid || !macroId || !Number.isFinite(intervalSec) || intervalSec <= 0) {
      return false;
    }

    // Check if macro should be delayed due to recent failures
    if (this.shouldDelayDueToFailures(sid, macroId)) {
      return false;
    }

    const now = Date.now();
    const intervalMs = Math.max(1, Number(intervalSec)) * 1000;

    const sidTimers = this.macroTimers.get(sid);
    if (!sidTimers) {
      const newSidTimers = new Map();
      newSidTimers.set(macroId, now);
      this.macroTimers.set(sid, newSidTimers);
      return false;
    }

    const lastSent = sidTimers.get(macroId);
    if (!lastSent || !Number.isFinite(lastSent)) {
      sidTimers.set(macroId, now);
      return false;
    }

    const timeSinceLastSent = now - lastSent;
    return timeSinceLastSent >= intervalMs;
  }

  /**
   * Mark a macro as sent, updating only its individual timer
   * @param {string} sid - Session ID
   * @param {string} macroId - Macro ID
   */
  markMacroSent(sid, macroId) {
    if (!sid || !macroId) {
      return;
    }

    let sidTimers = this.macroTimers.get(sid);
    if (!sidTimers) {
      sidTimers = new Map();
      this.macroTimers.set(sid, sidTimers);
    }

    const now = Date.now();
    sidTimers.set(macroId, now);

    // Reset failure tracking on successful send
    this.resetFailureTracking(sid, macroId);

    // Timer updated silently
  }

  /**
   * Record a macro send failure for backoff calculation
   * @param {string} sid - Session ID
   * @param {string} macroId - Macro ID
   * @param {Object} errorDetails - Error information
   */
  recordFailure(sid, macroId, errorDetails = {}) {
    if (!sid || !macroId) return;

    // Initialize failure tracking maps if needed
    let sidFailures = this.failureCount.get(sid);
    if (!sidFailures) {
      sidFailures = new Map();
      this.failureCount.set(sid, sidFailures);
    }

    let sidFailureTimes = this.lastFailureTime.get(sid);
    if (!sidFailureTimes) {
      sidFailureTimes = new Map();
      this.lastFailureTime.set(sid, sidFailureTimes);
    }

    const currentCount = sidFailures.get(macroId) || 0;
    const now = Date.now();

    sidFailures.set(macroId, currentCount + 1);
    sidFailureTimes.set(macroId, now);

    // Failure recorded silently
  }

  /**
   * Reset failure tracking for a macro
   * @param {string} sid - Session ID
   * @param {string} macroId - Macro ID
   */
  resetFailureTracking(sid, macroId) {
    const sidFailures = this.failureCount.get(sid);
    if (sidFailures) {
      sidFailures.delete(macroId);
    }

    const sidFailureTimes = this.lastFailureTime.get(sid);
    if (sidFailureTimes) {
      sidFailureTimes.delete(macroId);
    }
  }

  /**
   * Check if a macro should be delayed due to recent failures
   * @param {string} sid - Session ID
   * @param {string} macroId - Macro ID
   * @returns {boolean} - Whether the macro should be delayed
   */
  shouldDelayDueToFailures(sid, macroId) {
    const sidFailures = this.failureCount.get(sid);
    const sidFailureTimes = this.lastFailureTime.get(sid);

    if (!sidFailures || !sidFailureTimes) return false;

    const failureCount = sidFailures.get(macroId) || 0;
    const lastFailureTime = sidFailureTimes.get(macroId) || 0;

    if (failureCount === 0) return false;

    const now = Date.now();
    const timeSinceLastFailure = now - lastFailureTime;

    // Exponential backoff: 30s, 60s, 120s, max 300s (5 minutes)
    const backoffDelay = Math.min(30000 * Math.pow(2, failureCount - 1), 300000);

    return timeSinceLastFailure < backoffDelay;
  }

  /**
   * Get the last sent time for a specific macro
   * @param {string} sid - Session ID
   * @param {string} macroId - Macro ID
   * @returns {number|null} - Last sent timestamp or null if never sent
   */
  getLastSentTime(sid, macroId) {
    const sidTimers = this.macroTimers.get(sid);
    if (!sidTimers) {
      return null;
    }
    return sidTimers.get(macroId) || null;
  }

  /**
   * Clean up timers for sessions that no longer exist
   * @param {Set<string>} activeSids - Set of currently active session IDs
   */
  cleanupStaleTimers(activeSids) {
    let cleanedCount = 0;
    for (const sid of this.macroTimers.keys()) {
      if (!activeSids.has(sid)) {
        const timerCount = this.macroTimers.get(sid)?.size || 0;
        this.macroTimers.delete(sid);
        this.failureCount.delete(sid);
        this.lastFailureTime.delete(sid);

        // Cleanup completed silently
        cleanedCount++;
      }
    }
  }

  /**
   * Get debug information for a specific session
   * @param {string} sid - Session ID
   * @returns {Object} - Debug information
   */
  getDebugInfo(sid) {
    const sidTimers = this.macroTimers.get(sid);
    const sidFailures = this.failureCount.get(sid);
    const sidFailureTimes = this.lastFailureTime.get(sid);

    if (!sidTimers) {
      return { sid, timers: {}, totalMacros: 0, failures: {} };
    }

    const timers = {};
    const failures = {};
    const now = Date.now();

    for (const [macroId, lastSent] of sidTimers.entries()) {
      const failureCount = sidFailures?.get(macroId) || 0;
      const lastFailureTime = sidFailureTimes?.get(macroId) || 0;
      const isDelayed = this.shouldDelayDueToFailures(sid, macroId);

      timers[macroId] = {
        lastSent,
        timeSinceLastSent: now - lastSent,
        lastSentFormatted: new Date(lastSent).toISOString(),
        failureCount,
        lastFailureTime: lastFailureTime ? new Date(lastFailureTime).toISOString() : null,
        isDelayedDueToFailures: isDelayed
      };

      if (failureCount > 0) {
        failures[macroId] = {
          count: failureCount,
          lastFailure: new Date(lastFailureTime).toISOString(),
          timeSinceLastFailure: now - lastFailureTime,
          isDelayed
        };
      }
    }

    return {
      sid,
      timers,
      failures,
      totalMacros: sidTimers.size,
      totalFailedMacros: Object.keys(failures).length,
      timestamp: new Date().toISOString()
    };
  }
}

// Create global instance of macro timer manager
const macroTimerManager = new MacroTimerManager();

// Cache management functions
function invalidateLiveCache(sid, reason = 'manual') {
  if (liveCache.has(sid)) {
    liveCache.delete(sid);
    // Live cache invalidated silently
  }
}

function invalidateMacroLiveCache(sid, reason = 'manual') {
  if (macroLiveCache.has(sid)) {
    macroLiveCache.delete(sid);
    // Macro live cache invalidated silently
  }
}

function invalidateMacroCache(sid, reason = 'manual') {
  if (macroCache.has(sid)) {
    macroCache.delete(sid);
    // Macro cache invalidated silently
  }
}

function invalidateMacroTimers(sid, macroId = null, reason = 'manual') {
  if (macroId) {
    // Invalidate specific macro timer
    const sidTimers = macroTimerManager.macroTimers.get(sid);
    if (sidTimers && sidTimers.has(macroId)) {
      sidTimers.delete(macroId);
      // Macro timer invalidated silently
    }
  } else {
    // Invalidate all macro timers for this sid
    if (macroTimerManager.macroTimers.has(sid)) {
      macroTimerManager.macroTimers.delete(sid);
      // All macro timers invalidated silently
    }
  }
}

// Cache corruption recovery function
function recoverCorruptedCache(sid) {
  macroCache.delete(sid);
  liveCache.delete(sid);
  macroLiveCache.delete(sid);
  macroLastSent.delete(sid);
  macroTimerManager.macroTimers.delete(sid);
  macroTimerManager.failureCount.delete(sid);
  macroTimerManager.lastFailureTime.delete(sid);
  // Cache and failure tracking recovered silently
}

// Debug function to get detailed live status information
async function getLiveStatusDebugInfo(sid) {
  try {
    const settings = await getBotSettings(sid) || {};
    const stats = await getBotStats(sid);
    const cachedEntry = liveCache.get(sid);
    const currentTime = Date.now();

    const debugInfo = {
      sid,
      onlyWhenLive: !!settings.onlyWhenLive,
      lastActive: stats?.lastActive || null,
      lastActiveAge: stats?.lastActive ? currentTime - Date.parse(stats.lastActive) : null,
      cachedLiveStatus: cachedEntry?.live || null,
      cacheAge: cachedEntry ? currentTime - cachedEntry.checkedAt : null,
      currentLiveStatus: await isSidLive(sid),
      timestamp: new Date().toISOString()
    };

    return debugInfo;
  } catch (error) {
    return {
      sid,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Cleanup function for cache management (prevents memory leaks)
function cleanupStaleCache() {
  const currentTime = Date.now();
  const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

  // Clean up stale live cache entries
  for (const [sid, entry] of liveCache.entries()) {
    if (currentTime - entry.checkedAt > STALE_THRESHOLD_MS) {
      liveCache.delete(sid);
    }
  }

  // Clean up stale macro live cache entries
  for (const [sid, entry] of macroLiveCache.entries()) {
    if (currentTime - entry.checkedAt > STALE_THRESHOLD_MS) {
      macroLiveCache.delete(sid);
    }
  }

  // Clean up stale macro cache entries
  for (const [sid, entry] of macroCache.entries()) {
    if (currentTime - entry.fetchedAt > STALE_THRESHOLD_MS) {
      macroCache.delete(sid);
    }
  }

  // Clean up stale macro timer entries for sessions that no longer exist (legacy)
  for (const sid of macroLastSent.keys()) {
    if (!sessionStore.has(sid)) {
      macroLastSent.delete(sid);
    }
  }

  // Clean up stale macro timer entries using new manager
  const activeSids = new Set(sessionStore.keys());
  macroTimerManager.cleanupStaleTimers(activeSids);
}

// Performance monitoring and memory management (removed duplicate class)

// Memory management for caches
class CacheManager {
  constructor() {
    this.maxCacheSize = {
      macro: 1000,    // Max 1000 sessions in macro cache
      live: 1000,     // Max 1000 sessions in live cache  
      timer: 2000     // Max 2000 sessions in timer cache
    };
    this.cleanupThresholds = {
      macro: 0.8,     // Clean when 80% full
      live: 0.8,      // Clean when 80% full
      timer: 0.9      // Clean when 90% full
    };
  }

  checkAndCleanupCache(cacheType, cache, getLastAccess = null) {
    const maxSize = this.maxCacheSize[cacheType];
    const threshold = this.cleanupThresholds[cacheType];

    if (cache.size < maxSize * threshold) {
      return 0; // No cleanup needed
    }

    const targetSize = Math.floor(maxSize * 0.7); // Clean to 70% capacity
    const itemsToRemove = cache.size - targetSize;

    if (itemsToRemove <= 0) return 0;

    // Get entries sorted by last access time (oldest first)
    let entries = Array.from(cache.entries());

    if (getLastAccess) {
      entries.sort((a, b) => {
        const timeA = getLastAccess(a[0]) || 0;
        const timeB = getLastAccess(b[0]) || 0;
        return timeA - timeB;
      });
    }

    // Remove oldest entries
    let removedCount = 0;
    for (let i = 0; i < Math.min(itemsToRemove, entries.length); i++) {
      const [key] = entries[i];
      cache.delete(key);
      removedCount++;
    }

    if (removedCount > 0) {
      console.log(`[CACHE-CLEANUP] Removed ${removedCount} entries from ${cacheType} cache (${cache.size}/${maxSize})`);
    }

    return removedCount;
  }

  cleanupMacroCache() {
    return this.checkAndCleanupCache('macro', macroCache, (sid) => {
      const entry = macroCache.get(sid);
      return entry?.fetchedAt || 0;
    });
  }

  cleanupLiveCache() {
    return this.checkAndCleanupCache('live', liveCache, (sid) => {
      const entry = liveCache.get(sid);
      return entry?.checkedAt || 0;
    });
  }

  cleanupTimerCache() {
    return this.checkAndCleanupCache('timer', macroTimerManager.macroTimers, (sid) => {
      // Use session activity from performance monitor if available
      return performanceMonitor.metrics.sessionActivity.get(sid) || 0;
    });
  }

  performFullCleanup() {
    const results = {
      macro: this.cleanupMacroCache(),
      live: this.cleanupLiveCache(),
      timer: this.cleanupTimerCache()
    };

    const totalCleaned = Object.values(results).reduce((a, b) => a + b, 0);
    if (totalCleaned > 0) {
      console.log(`[CACHE-MANAGER] Full cleanup completed, removed ${totalCleaned} total entries`);
    }

    return results;
  }
}

// Enhanced session cleanup with performance tracking
function cleanupInactiveSessions() {
  const now = Date.now();
  const inactiveThreshold = 60 * 60 * 1000; // 1 hour
  const activeSids = new Set();

  // Collect active sessions from sessionStore
  for (const [sid, entry] of sessionStore.entries()) {
    if (entry && entry.sessionKey) {
      activeSids.add(sid);
    }
  }

  // Add sessions that have recent macro activity
  for (const [sid, sidMetrics] of performanceMonitor.metrics.entries()) {
    if (sidMetrics && sidMetrics.sessionActivity && (now - sidMetrics.sessionActivity < inactiveThreshold)) {
      activeSids.add(sid);
    }
  }

  // Clean up timer states for inactive sessions
  macroTimerManager.cleanupStaleTimers(activeSids);

  // Clean up performance metrics for very old sessions
  performanceMonitor.cleanupStaleMetrics();

  // Perform cache cleanup if needed
  cacheManager.performFullCleanup();
}

// Create global instances
// Note: performanceMonitor is already declared earlier
const cacheManager = new CacheManager();

// Run cache cleanup every 30 minutes
setInterval(cleanupStaleCache, 30 * 60 * 1000);

// Run enhanced session cleanup every 15 minutes
setInterval(cleanupInactiveSessions, 15 * 60 * 1000);

// Record memory usage every 5 minutes
setInterval(() => {
  performanceMonitor.recordMemoryUsage();
}, 5 * 60 * 1000);

setInterval(async () => {
  try {
    const now = Date.now();
    const activeSidsArray = Array.from(activeSids.keys());

    const recentSids = activeSidsArray.filter(sid => {
      const lastSeen = activeSids.get(sid);
      return lastSeen && (now - lastSeen) < (60 * 60 * 1000); // 1?쒓컙
    });

    if (recentSids.length === 0) return;

    console.log(`[Session-Validation] Starting validation for ${recentSids.length} active sessions`);

    let validatedCount = 0;
    let errorCount = 0;

    for (const sid of recentSids) {
      try {
        await validateAndRecoverSessionState(sid);
        validatedCount++;

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        errorCount++;
        performanceMonitor.recordError('session_validation_failed', sid);
        console.error(`[Session-Validation] Failed for ${sid}:`, error.message);
      }
    }

    console.log(`[Session-Validation] Completed: ${validatedCount} validated, ${errorCount} errors`);

    logPerformanceMetrics('session_validation_batch', null, {
      duration: Date.now() - now,
      totalSessions: recentSids.length,
      validatedCount,
      errorCount,
      cacheHit: false
    });

  } catch (error) {
    console.error('[Session-Validation] Batch validation failed:', error);
    performanceMonitor.recordError('session_validation_batch_failed');
  }
}, 10 * 60 * 1000);

setInterval(() => {
  try {
    performanceMonitor.cleanupStaleMetrics();
  } catch (error) {
    console.error('[Performance] Failed to cleanup metrics:', error);
  }
}, 60 * 60 * 1000);

// Determine if a sid is currently considered LIVE for macro purposes.
// Checks every connected streaming platform instead of assuming CHZZK-only live state.
async function isSidLive(sid) {
  // Validate input
  if (!sid || typeof sid !== 'string') {
    console.warn('isSidLive called with invalid sid:', sid);
    return false;
  }

  try {
    const settings = await getBotSettings(sid) || {};
    const onlyWhenLive = !!settings.onlyWhenLive;

    // Clear branch: if onlyWhenLive is false, always consider live
    if (!onlyWhenLive) {
      return true;
    }

    const info = await getLiveInfoForSid(sid);
    return !!info?.live;

  } catch (error) {
    // If we can't get settings, default to not live for safety
    console.warn(`Failed to get bot settings for live check (sid: ${sid}):`, error.message);
    return false;
  }
}

async function isSidActuallyLive(sid) {
  // Validate input
  if (!sid || typeof sid !== 'string') {
    console.warn('isSidActuallyLive called with invalid sid:', sid);
    return false;
  }

  try {
    const info = await getLiveInfoForSid(sid);
    return !!info?.live;

  } catch (error) {
    console.warn(`Failed to get bot settings for actual live check (sid: ${sid}):`, error.message);
    return false;
  }
}

async function getLiveCached(sid) {
  const cachedEntry = liveCache.get(sid);
  const currentTime = Date.now();
  const CACHE_TTL_MS = 8000; // 8 seconds cache TTL

  // Check if cache is valid
  if (cachedEntry && (currentTime - cachedEntry.checkedAt) <= CACHE_TTL_MS) {
    // Record cache hit
    performanceMonitor.recordCacheOperation('live', true);
    return cachedEntry.live;
  }

  // Record cache miss
  performanceMonitor.recordCacheOperation('live', false);

  // Cache is invalid or doesn't exist, fetch fresh live status
  let liveStatus = false;
  try {
    liveStatus = await isSidLive(sid);
  } catch (error) {
    // On error, default to false (not live) for safety
    console.warn(`Live status check failed for sid ${sid}:`, error.message);
    liveStatus = false;
  }

  // Log live status changes for debugging
  if (cachedEntry && cachedEntry.live !== liveStatus) {
    console.log(`Live status changed for sid ${sid}: ${cachedEntry.live} -> ${liveStatus}`);
  } else if (!cachedEntry) {
    console.log(`Initial live status for sid ${sid}: ${liveStatus}`);
  }

  // Update cache with new status
  liveCache.set(sid, {
    live: liveStatus,
    checkedAt: currentTime
  });

  // Check if cache cleanup is needed
  cacheManager.cleanupLiveCache();

  return liveStatus;
}

const macroLiveCache = new Map(); // sid -> { live: boolean, checkedAt }

async function getMacroLiveCached(sid) {
  const cachedEntry = macroLiveCache.get(sid);
  const currentTime = Date.now();
  const CACHE_TTL_MS = 8000;

  if (cachedEntry && (currentTime - cachedEntry.checkedAt) <= CACHE_TTL_MS) {
    performanceMonitor.recordCacheOperation('macro_live', true);
    return cachedEntry.live;
  }

  performanceMonitor.recordCacheOperation('macro_live', false);

  let liveStatus = false;
  try {
    liveStatus = await isSidActuallyLive(sid);
  } catch (error) {
    console.warn(`Macro live status check failed for sid ${sid}:`, error.message);
    liveStatus = false;
  }

  if (cachedEntry && cachedEntry.live !== liveStatus) {
    console.log(`Macro live status changed for sid ${sid}: ${cachedEntry.live} -> ${liveStatus}`);
  } else if (!cachedEntry) {
    console.log(`Initial macro live status for sid ${sid}: ${liveStatus}`);
  }

  macroLiveCache.set(sid, {
    live: liveStatus,
    checkedAt: currentTime
  });

  return liveStatus;
}

async function getMacrosCached(sid) {
  const ent = macroCache.get(sid);
  const now = Date.now();
  const CACHE_TTL = 10000; // 10 seconds

  // Check if cache is valid
  if (ent && (now - ent.fetchedAt) <= CACHE_TTL) {
    // Record cache hit
    performanceMonitor.recordCacheOperation('macro', true);
    return ent.macros || [];
  }

  // Record cache miss
  performanceMonitor.recordCacheOperation('macro', false);

  // Cache is stale or doesn't exist, refresh it
  try {
    const s = await getBotSettings(sid) || {};
    const rawMacros = Array.isArray(s.macros) ? s.macros : [];

    // Enhanced macro validation and filtering
    const macros = rawMacros.filter(m => {
      if (!m || typeof m !== 'object') return false;
      if (m.enabled === false) return false;
      if (!m.message || typeof m.message !== 'string' || m.message.trim() === '') return false;

      const intervalSec = Number(m.intervalSec);
      if (!Number.isFinite(intervalSec) || intervalSec <= 0) return false;

      // Minimum interval of 1 second for safety
      if (intervalSec < 1) return false;

      return true;
    }).map(m => ({
      ...m,
      id: m.id || `macro_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Ensure ID exists
      intervalSec: Number(m.intervalSec),
      message: String(m.message).trim()
    }));

    // Update cache with validated macros
    macroCache.set(sid, {
      macros,
      fetchedAt: now,
      validationErrors: rawMacros.length - macros.length // Track how many were filtered out
    });

    // Check if cache cleanup is needed
    cacheManager.cleanupMacroCache();

    // Macro cache refreshed silently
    return macros;

  } catch (error) {
    console.error(`Failed to refresh macro cache for sid: ${sid}, error: ${error.message}`);

    // Return stale cache if available, otherwise empty array
    if (ent && Array.isArray(ent.macros)) {
      console.warn(`Using stale macro cache for sid: ${sid}, age: ${now - ent.fetchedAt}ms`);
      return ent.macros;
    }

    return [];
  }
}

function getMacroDeliveryTargets() {
  const targets = [];
  const seen = new Set();
  const add = (target) => {
    if (!target?.sid || !target?.provider || !target?.chatPost) return;
    const key = `${target.sid}:${target.provider}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(target);
  };

  for (const [sid, entry] of sessionStore.entries()) {
    if (!entry?.sessionKey) continue;
    add({
      sid,
      provider: 'chzzk',
      chatPost: makeChzzkChatPost(entry.sessionKey, null, '자동 알림'),
    });
  }

  for (const [ownerUserId, entry] of cimeSessionStore.entries()) {
    if (!entry?.connected) continue;
    const sid = entry.primarySid || `user:${ownerUserId}`;
    add({
      sid,
      provider: 'cime',
      ownerUserId,
      channelId: entry.channelId || null,
      chatPost: makeCimeChatPost(ownerUserId, '자동 알림'),
    });
  }

  for (const [ownerUserId, entry] of youtubeSessionStore.entries()) {
    if (!entry?.connected && !entry?.liveChatId) continue;
    const sid = entry.primarySid || `user:${ownerUserId}`;
    add({
      sid,
      provider: 'youtube',
      ownerUserId,
      chatPost: makeYoutubeChatPost(ownerUserId, entry.liveChatId || null, '자동 알림'),
    });
  }

  return targets;
}

async function isMacroDeliveryTargetLive(target) {
  const provider = String(target?.provider || '').toLowerCase();
  const sid = String(target?.sid || '');
  if (!sid) return false;

  if (provider === 'cime') {
    const live = await refreshCimeLiveStatus(target.ownerUserId, sid, target.channelId).catch(() => false);
    if (live) return true;
    const cached = liveStatusCache.get(sid);
    return cached?.provider === 'cime' && cached.live === true && Date.now() - Number(cached.ts || 0) < 2 * 60 * 1000;
  }

  if (provider === 'youtube') {
    const state = await refreshYoutubeLiveStatus(target.ownerUserId, sid, { ttlMs: 30 * 1000 }).catch(() => null);
    return !!state?.live;
  }

  const info = await getLiveInfoForSid(sid).catch(() => null);
  return !!info?.live && (!info.provider || info.provider === 'chzzk');
}

setInterval(async () => {
  try {
    for (const target of getMacroDeliveryTargets()) {
      const sid = target.sid;

      const live = await isMacroDeliveryTargetLive(target);
      if (!live) continue;
      const macros = await getMacrosCached(sid);
      if (!macros.length) continue;

      // Process macros without detailed logging

      // Process each macro independently using the new timer manager
      let macrosSentCount = 0;
      for (const m of macros) {
        const timerMacroId = `${m.id}:${target.provider}`;
        // Check if this specific macro should be sent based on its individual timer
        if (macroTimerManager.shouldSendMacro(sid, timerMacroId, m.intervalSec)) {
          let msg = String(m.message || '').slice(0, 1000);
          try {
            msg = String(await substituteAllPlaceholders(String(m.message || ''), sid, '', '') || '').slice(0, 1000);
          } catch { }
          let sendSuccess = false;
          let errorDetails = null;
          const sendStartTime = Date.now();

          try {
            const response = await sendChatByPost(sid, target.chatPost, msg, { timeout: 5000 });

            // Check response status for additional validation
            if (response != null) {
              sendSuccess = true;
              const responseTime = Date.now() - sendStartTime;

              // Mark macro as sent silently
              macroTimerManager.markMacroSent(sid, timerMacroId);
            } else {
              throw new Error('Macro chat send returned empty response');
            }
          } catch (error) {
            // Enhanced error handling with categorization
            errorDetails = {
              type: error.code || 'UNKNOWN',
              message: error.message,
              status: error.response?.status,
              isTimeout: error.code === 'ECONNABORTED' || error.message.includes('timeout'),
              isNetworkError: error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED'
            };

            sendSuccess = false;

            // Record the failure for backoff calculation
            macroTimerManager.recordFailure(sid, timerMacroId, errorDetails);

            // For critical errors, consider invalidating cache to refresh session
            if (errorDetails.status === 401 || errorDetails.status === 403) {
              console.warn(`Authentication error for macro send, invalidating caches for sid: ${sid}`);
              invalidateMacroCache(sid, 'auth_error');
              invalidateLiveCache(sid, 'auth_error');
              invalidateMacroLiveCache(sid, 'auth_error');
            }
          }

          // Update counters
          if (sendSuccess) {
            macrosSentCount++;
          }

          // Enhanced burst prevention with adaptive delay
          // Longer delay if we've sent multiple macros or if there was an error
          const baseDelay = 80;
          const adaptiveDelay = sendSuccess ?
            baseDelay + (macrosSentCount * 20) : // Increase delay for each successful send
            Math.min(baseDelay * 2, 200); // Double delay on error, max 200ms

          await new Promise(r => setTimeout(r, adaptiveDelay));
        }
      }
    }
  } catch (error) {
    console.error('Macro runner error:', error.message);
  }
}, 1000);

// Donation settings and rules APIs (stored under bot settings per sid)
function normalizeDonationAmountOperator(value) {
  const text = String(value || '').toLowerCase();
  if (['lt', 'below', 'less_than'].includes(text)) return 'lt';
  if (['eq', 'equal', 'equals'].includes(text)) return 'eq';
  if (['range', 'between'].includes(text)) return 'range';
  return 'gte';
}

function normalizeDonationAmountNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function normalizeDonationAmountConditions(rule = {}) {
  const rawConditions = Array.isArray(rule.amountConditions) ? rule.amountConditions : [];
  const conditions = rawConditions
    .map((condition) => {
      const operator = normalizeDonationAmountOperator(condition?.operator);
      const amount = normalizeDonationAmountNumber(condition?.amount);
      const amountTo = operator === 'range' ? normalizeDonationAmountNumber(condition?.amountTo) : null;
      return {
        id: String(condition?.id || `cond_${Math.random().toString(36).slice(2, 8)}`),
        operator,
        amount,
        amountTo,
      };
    })
    .filter((condition) => condition.operator !== 'range' || Number(condition.amountTo || 0) >= condition.amount);
  if (conditions.length) return conditions;

  const min = rule.minAmount != null ? normalizeDonationAmountNumber(rule.minAmount) : 0;
  const max = rule.maxAmount != null && Number(rule.maxAmount) > 0 ? normalizeDonationAmountNumber(rule.maxAmount) : null;
  if (max != null) return [{ id: 'legacy_range', operator: 'range', amount: min, amountTo: max }];
  return [{ id: 'legacy_min', operator: 'gte', amount: min, amountTo: null }];
}

function deriveLegacyDonationAmountFields(conditions = []) {
  const first = conditions[0];
  if (!first) return { minAmount: 0, maxAmount: null };
  if (first.operator === 'range') return { minAmount: Number(first.amount || 0), maxAmount: Number(first.amountTo || 0) || null };
  if (first.operator === 'lt') return { minAmount: 0, maxAmount: Number(first.amount || 0) };
  if (first.operator === 'eq') return { minAmount: Number(first.amount || 0), maxAmount: Number(first.amount || 0) };
  return { minAmount: Number(first.amount || 0), maxAmount: null };
}

function normalizeDonationRuleForStorage(rule = {}) {
  const amountConditions = normalizeDonationAmountConditions(rule);
  return {
    ...rule,
    ...deriveLegacyDonationAmountFields(amountConditions),
    amountConditions,
    enabled: rule.enabled !== false,
  };
}

function donationRuleMatchesAmount(rule = {}, amountValue = 0) {
  const amount = normalizeDonationAmountNumber(amountValue);
  const conditions = normalizeDonationAmountConditions(rule);
  return conditions.every((condition) => {
    const target = Number(condition.amount || 0);
    if (condition.operator === 'lt') return amount < target;
    if (condition.operator === 'eq') return amount === target;
    if (condition.operator === 'range') return amount >= target && amount <= Number(condition.amountTo || 0);
    return amount >= target;
  });
}

// GET settings
app.get('/api/donation/settings', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const s = await getBotSettings(sid) || {};
    const donation = s.donation || {};
    return res.json({ settings: { pointsPerK: Math.max(0, Number(donation.pointsPerK ?? 10)) } });
  } catch { return res.status(500).json({ error: 'failed' }); }
});

// POST settings
app.post('/api/donation/settings', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const s = await getBotSettings(sid) || {};
    const pointsPerK = Math.max(0, Number(req.body?.settings?.pointsPerK ?? 10));
    const next = { ...s, donation: { ...(s.donation || {}), pointsPerK } };
    await setBotSettings(sid, next);
    return res.json({ ok: true, settings: next.donation });
  } catch { return res.status(500).json({ error: 'failed' }); }
});

// GET rules
app.get('/api/donation/rules', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const s = await getBotSettings(sid) || {};
    const rules = Array.isArray(s.donationRules) ? s.donationRules : [];
    return res.json({ rules: rules.map(normalizeDonationRuleForStorage) });
  } catch { return res.status(500).json({ error: 'failed' }); }
});

// UPSERT rule
app.post('/api/donation/rules/upsert', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const s = await getBotSettings(sid) || {};
    const incoming = req.body?.rule || {};
    const rules = Array.isArray(s.donationRules) ? s.donationRules.slice() : [];
    let idx = rules.findIndex(r => String(r.id || '') === String(incoming.id || ''));
    const normalizedIncoming = normalizeDonationRuleForStorage(incoming);
    if (idx < 0) {
      normalizedIncoming.id = normalizedIncoming.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      rules.push(normalizedIncoming);
    } else {
      rules[idx] = normalizeDonationRuleForStorage({ ...rules[idx], ...incoming });
    }
    const next = { ...s, donationRules: rules };
    await setBotSettings(sid, next);
    return res.json({ ok: true, rule: idx < 0 ? normalizedIncoming : rules[idx] });
  } catch { return res.status(500).json({ error: 'failed' }); }
});

// DELETE rule
app.post('/api/donation/rules/delete', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const id = String(req.body?.id || '');
    const s = await getBotSettings(sid) || {};
    const rules = (Array.isArray(s.donationRules) ? s.donationRules : []).filter(r => String(r.id || '') !== id);
    const next = { ...s, donationRules: rules };
    await setBotSettings(sid, next);
    return res.json({ ok: true });
  } catch { return res.status(500).json({ error: 'failed' }); }
});

function normalizeRouletteDefinition(input = {}) {
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();
  const type = String(input.type || 'items') === 'probability' ? 'probability' : 'items';
  const themeText = String(input.theme || 'studio').toLowerCase();
  const skinAliases = new Map([
    ['classic', 'studio'],
    ['fire', 'solar'],
    ['ice', 'ocean'],
    ['pastel', 'prism'],
    ['forest', 'aurora'],
    ['midnight', 'mono'],
    ['sunset', 'solar'],
  ]);
  const allowedThemes = new Set(['studio', 'prism', 'aurora', 'velvet', 'mono', 'deco', 'crystal', 'ink', 'nova', 'ceramic', 'arcade', 'sakura', 'ocean', 'solar', 'cyber', 'gold', 'classic', 'fire', 'ice', 'pastel', 'forest', 'midnight', 'sunset']);
  const allowedLayouts = new Set(['reel', 'wheel']);
  const themeParts = themeText.split(/[:_\-\s]+/).filter(Boolean);
  const rawTheme = themeParts.find((part) => allowedThemes.has(part)) || '';
  const parsedTheme = skinAliases.get(rawTheme) || rawTheme;
  const parsedLayout = themeParts.find((part) => allowedLayouts.has(part)) || '';
  const normalizedTheme = parsedTheme ? (parsedLayout ? `${parsedLayout}:${parsedTheme}` : parsedTheme) : 'studio';
  const items = (Array.isArray(input.items) ? input.items : [])
    .map((item) => ({
      label: String(item?.label || '').trim(),
      value: item?.value == null || item?.value === '' ? null : String(item.value),
      weight: Math.max(1, Number(item?.weight || 1)),
      probability: Number.isFinite(Number(item?.probability)) ? Math.max(0, Number(item.probability)) : undefined,
    }))
    .filter((item) => item.label);
  return {
    id: id || `rlt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    type,
    theme: normalizedTheme,
    items,
  };
}

function makeQuickStartCommandRules() {
  return [
    {
      id: 'tpl_cmd_points',
      name: '포인트 확인',
      keywords: ['!포인트', '!point', '!points'],
      responses: ['{user.username}님은 현재 {user.points}P를 가지고 있어요.'],
      enabled: true,
      adminOnly: false,
      requiredRoleLevel: 1,
      pointsCost: 0,
      cooldown: 5000,
      lastUsed: 0,
    },
    {
      id: 'tpl_cmd_commands',
      name: '명령어 안내',
      keywords: ['!명령어', '!commands'],
      responses: ['사용 가능한 명령어와 참여 정보는 {live.channel}의 공개 페이지에서 확인할 수 있어요.'],
      enabled: true,
      adminOnly: false,
      requiredRoleLevel: 1,
      pointsCost: 0,
      cooldown: 5000,
      lastUsed: 0,
    },
    {
      id: 'tpl_cmd_roulette',
      name: '오늘의 룰렛',
      keywords: ['!룰렛'],
      responses: ['{user.username}님이 오늘의 룰렛을 돌립니다. ${roulette::오늘의 룰렛}'],
      enabled: true,
      adminOnly: false,
      requiredRoleLevel: 1,
      pointsCost: 100,
      cooldown: 10000,
      lastUsed: 0,
    },
    {
      id: 'tpl_cmd_video_donation',
      name: '영상 후원 신청',
      keywords: ['!영상', '!영도'],
      responses: ['${video_donation}'],
      enabled: true,
      adminOnly: false,
      requiredRoleLevel: 1,
      pointsCost: 0,
      cooldown: 5000,
      lastUsed: 0,
    },
  ];
}

function makeQuickStartRouletteDefinition() {
  return normalizeRouletteDefinition({
    id: 'tpl_rlt_today',
    name: '오늘의 룰렛',
    type: 'items',
    theme: 'reel:studio',
    items: [
      { label: '칭찬 한마디', value: '채팅으로 칭찬 한마디!', weight: 3 },
      { label: '보너스 100P', value: '보너스 100P', weight: 2 },
      { label: '다음 기회', value: '아쉽지만 다음 기회!', weight: 4 },
      { label: '특별 리액션', value: '방송 리액션!', weight: 1 },
    ],
  });
}

function hasAnyKeyword(rules, keywords) {
  const wanted = new Set((keywords || []).map((keyword) => String(keyword || '').trim().toLowerCase()).filter(Boolean));
  return (rules || []).some((rule) => (
    Array.isArray(rule?.keywords) &&
    rule.keywords.some((keyword) => wanted.has(String(keyword || '').trim().toLowerCase()))
  ));
}

function hasNamedItem(items, name) {
  const target = String(name || '').trim().toLowerCase();
  return (items || []).some((item) => String(item?.name || '').trim().toLowerCase() === target);
}

app.post('/api/setup/templates/apply', rateLimiters.userWrite, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const template = String(req.body?.template || 'quick-start').trim();
    if (template !== 'quick-start') return res.status(400).json({ error: 'Unknown template' });

    const settings = await getBotSettings(sid) || {};
    const currentRules = await getBotRules(sid).catch(() => []);
    const applied = [];
    const skipped = [];

    for (const rule of makeQuickStartCommandRules()) {
      if (hasAnyKeyword(currentRules, rule.keywords)) {
        skipped.push({ type: 'command', name: rule.name, reason: 'keyword_exists' });
        continue;
      }
      await upsertBotRule(sid, rule);
      currentRules.push(rule);
      applied.push({ type: 'command', name: rule.name });
    }

    const rouletteDefs = Array.isArray(settings.rouletteDefs) ? settings.rouletteDefs.slice() : [];
    const starterRoulette = makeQuickStartRouletteDefinition();
    if (hasNamedItem(rouletteDefs, starterRoulette.name)) {
      skipped.push({ type: 'roulette', name: starterRoulette.name, reason: 'name_exists' });
    } else {
      rouletteDefs.push(starterRoulette);
      applied.push({ type: 'roulette', name: starterRoulette.name });
    }

    const macros = Array.isArray(settings.macros) ? settings.macros.slice() : [];
    const starterMacroMessage = '!포인트로 내 포인트를 확인하고, !룰렛으로 오늘의 룰렛에 참여해 보세요.';
    if (macros.some((macro) => String(macro?.message || '').trim() === starterMacroMessage)) {
      skipped.push({ type: 'macro', name: '참여 안내 알림', reason: 'message_exists' });
    } else {
      macros.push({
        id: 'tpl_macro_participation',
        message: starterMacroMessage,
        intervalSec: 600,
        enabled: true,
      });
      applied.push({ type: 'macro', name: '참여 안내 알림' });
    }

    const nextSettings = {
      ...settings,
      botEnabled: true,
      attendanceAnnounce: settings.attendanceAnnounce ?? true,
      attendanceMessage: settings.attendanceMessage || '{user.name}님 출석체크 완료! (연속 {attendance.streak}일, 누적 {attendance.totalDays}일)',
      channelPointsPerChat: Number.isFinite(Number(settings.channelPointsPerChat)) ? Number(settings.channelPointsPerChat) : 1,
      channelPointsPerAttendance: Number.isFinite(Number(settings.channelPointsPerAttendance)) ? Number(settings.channelPointsPerAttendance) : 50,
      videoDonationAcceptEnabled: settings.videoDonationAcceptEnabled === true,
      videoDonationPointsPerSecond: Number.isFinite(Number(settings.videoDonationPointsPerSecond)) ? Number(settings.videoDonationPointsPerSecond) : 1,
      videoDonationMaxDurationSec: Number.isFinite(Number(settings.videoDonationMaxDurationSec)) ? Number(settings.videoDonationMaxDurationSec) : 600,
      rouletteDefs,
      macros,
      setupTemplates: {
        ...(settings.setupTemplates && typeof settings.setupTemplates === 'object' ? settings.setupTemplates : {}),
        quickStart: {
          appliedAt: new Date().toISOString(),
          version: 1,
        },
      },
    };
    await setBotSettings(sid, nextSettings);
    try { macroCache.delete(sid); } catch { }

    return res.json({
      ok: true,
      template,
      applied,
      skipped,
      counts: {
        applied: applied.length,
        skipped: skipped.length,
      },
    });
  } catch (e) {
    console.error('[Setup Template] apply error', e?.message || e);
    return res.status(500).json({ error: 'Failed to apply quick start template' });
  }
});

app.get('/api/roulette/definitions', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const settings = await getBotSettings(sid) || {};
    const definitions = Array.isArray(settings.rouletteDefs) ? settings.rouletteDefs : [];
    return res.json({ definitions });
  } catch (e) {
    console.error('[roulette:definitions:list] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to list roulette definitions' });
  }
});

app.post('/api/roulette/definitions/upsert', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const definition = normalizeRouletteDefinition(req.body?.definition || {});
    if (!definition.name) return res.status(400).json({ error: '룰렛 이름이 필요합니다.' });
    if (definition.items.length < 2) return res.status(400).json({ error: '룰렛 항목은 2개 이상 필요합니다.' });
    if (definition.type === 'probability') {
      const totalPercent = definition.items.reduce((sum, item) => sum + Number(item.probability || 0), 0);
      if (Math.abs(totalPercent - 100) > 0.001) {
        return res.status(400).json({ error: '확률형 룰렛은 확률 합계가 정확히 100%여야 합니다.' });
      }
    }

    const settings = await getBotSettings(sid) || {};
    const definitions = Array.isArray(settings.rouletteDefs) ? settings.rouletteDefs.slice() : [];
    const index = definitions.findIndex((item) => (
      String(item?.id || '') === definition.id ||
      String(item?.name || '').trim().toLowerCase() === definition.name.toLowerCase()
    ));
    if (index >= 0) definitions[index] = { ...definitions[index], ...definition, id: definitions[index].id || definition.id };
    else definitions.push(definition);

    await setBotSettings(sid, { ...settings, rouletteDefs: definitions });
    return res.json({ ok: true, definition });
  } catch (e) {
    console.error('[roulette:definitions:upsert] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to save roulette definition' });
  }
});

app.post('/api/roulette/definitions/delete', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const id = String(req.body?.id || '').trim();
    const name = String(req.body?.name || '').trim().toLowerCase();
    if (!id && !name) return res.status(400).json({ error: 'id or name is required' });
    const settings = await getBotSettings(sid) || {};
    const definitions = (Array.isArray(settings.rouletteDefs) ? settings.rouletteDefs : [])
      .filter((item) => String(item?.id || '') !== id && String(item?.name || '').trim().toLowerCase() !== name);
    await setBotSettings(sid, { ...settings, rouletteDefs: definitions });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[roulette:definitions:delete] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to delete roulette definition' });
  }
});

app.post('/api/roulette/test', rateLimiters.userWrite, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const settings = await getBotSettings(sid) || {};
    const definitions = getRouletteDefsFromSettings(settings);
    const id = String(req.body?.id || '').trim();
    const name = String(req.body?.name || '').trim();
    const definition = definitions.find((item) => (
      (id && String(item?.id || '') === id) ||
      (name && String(item?.name || '').trim().toLowerCase() === name.toLowerCase())
    ));
    if (!definition) return res.status(404).json({ error: '룰렛을 찾을 수 없습니다.' });
    const result = await startRouletteSpin(sid, definition.name, 'arubot_test_viewer', '테스트 시청자', { instant: true, suppressResultChat: true });
    return res.json({ ok: true, roulette: definition.name, result });
  } catch (e) {
    console.error('[roulette:test] error', e?.message || e);
    return res.status(500).json({ error: '룰렛 테스트를 실행하지 못했습니다.' });
  }
});

// Public: list roulette definitions by channel UID (no auth)
// GET /api/public/:uid/roulette-defs
app.get('/api/public/:uid/roulette-defs', async (req, res) => {
  try {
    const uid = String(req.params.uid || '').trim();
    if (!uid) return res.status(400).json({ error: 'uid required' });
    const sid = `user:${uid}`;
    const settings = await getBotSettings(sid) || {};
    const defs = Array.isArray(settings.rouletteDefs) ? settings.rouletteDefs : [];
    // Normalize shapes and compute probabilities for weighted roulette
    const result = defs.map((def) => {
      const type = String(def?.type || 'items');
      const items = Array.isArray(def?.items) ? def.items : [];
      if (type === 'probability') {
        // Ensure numeric probability field 0..100; compute probDecimal
        const outItems = items.map((it) => {
          const p = Number(it?.probability ?? 0);
          const pct = Number.isFinite(p) ? p : 0;
          const dec = pct > 1 ? (pct / 100) : pct; // accept 0..100 or 0..1
          return {
            label: String(it?.label || ''),
            value: it?.value ?? null,
            probabilityPercent: +((dec * 100).toFixed(3)),
            weight: Number.isFinite(it?.weight) ? Number(it.weight) : null,
          };
        });
        return { name: String(def?.name || ''), type: 'probability', theme: def?.theme || null, items: outItems };
      }
      // Weighted/items type: compute approximate probability from weights
      let sum = 0;
      const weights = items.map((it) => { const w = Math.max(0, Number(it?.weight ?? 0)); sum += w; return w; });
      const outItems = items.map((it, idx) => {
        const w = weights[idx];
        const prob = sum > 0 ? (w / sum) : 0;
        return {
          label: String(it?.label || ''),
          value: it?.value ?? null,
          weight: w,
          probabilityPercent: +((prob * 100).toFixed(3)),
        };
      });
      return { name: String(def?.name || ''), type: 'items', theme: def?.theme || null, items: outItems };
    });
    return res.json({ ok: true, defs: result });
  } catch (e) {
    return res.status(500).json({ error: 'failed' });
  }
});

// Proxy route used by the roulette queue to send chat via CHZZK OpenAPI.
// Expects Authorization header (Bearer <accessToken>) and sessionKey as query.
app.post('/api/chzzk/send', rateLimiters.userWrite, async (req, res) => {
  try {
    const sessionKey = String(req.query?.sessionKey || '');
    const auth = String(req.headers?.authorization || '');
    const message = String(req.body?.message || '');
    if (!sessionKey) return res.status(400).json({ error: 'sessionKey required' });
    if (!auth) return res.status(401).json({ error: 'authorization required' });
    if (!message) return res.status(400).json({ error: 'message required' });
    const url = `${OPENAPI_BASE}/open/v1/chats/send`;
    const r = await axios.post(url, { message }, {
      params: { sessionKey },
      headers: { Authorization: auth, 'Content-Type': 'application/json' }
    });
    const content = r?.data?.content || r?.data || {};
    return res.json({ ok: true, messageId: content.messageId || content.id || null });
  } catch (e) {
    return res.status(500).json({ error: 'failed_to_send', detail: e?.response?.data || e?.message || String(e) });
  }
});

// Admin panel: get roulette viewer URL (fixed per-sid token)
app.get('/api/roulette/viewer-url', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const settings = await getBotSettings(sid) || {};
    let uid = null;
    try { uid = await resolveStreamerUidForSid(sid); } catch { }
    let token = uid ? await getOrCreateViewerTokenSupabase(uid, 'roulette', sid, 'rlt').catch(() => null) : null;
    if (!token) {
      token = typeof settings.rouletteViewerToken === 'string' && settings.rouletteViewerToken.trim()
        ? String(settings.rouletteViewerToken).trim()
        : '';
    }
    if (!token) {
      token = 'rlt_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
      const next = { ...settings, rouletteViewerToken: token };
      await setBotSettings(sid, next);
    } else if (settings.rouletteViewerToken !== token) {
      try { await setBotSettings(sid, { ...settings, rouletteViewerToken: token }); } catch { }
    }
    try { rouletteTokenToSid.set(token, sid); } catch { }
    const path = `/roulette/${encodeURIComponent(token)}`;
    return res.json({ sid, token, path });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to get viewer url' });
  }
});

// POST reorder queue by exact ids order
app.post('/api/video-donation/reorder', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
    if (!ids || !ids.length) return res.status(400).json({ error: 'ids required' });
    const q = getVideoQueue(sid);
    const beforeHead = q[0] ? String(q[0].id) : null;
    // Validate same elements
    const curIds = new Set(q.map(it => String(it.id)));
    if (ids.length !== q.length || ids.some(id => !curIds.has(String(id)))) {
      return res.status(400).json({ error: 'ids mismatch' });
    }
    // Rebuild queue
    const byId = new Map(q.map(it => [String(it.id), it]));
    const reordered = ids.map(id => byId.get(String(id))).filter(Boolean);
    videoDonationQueues.set(sid, reordered);
    const afterHead = reordered[0] ? String(reordered[0].id) : null;
    // If head changed, broadcast start (clients dedupe) and reschedule
    if (beforeHead !== afterHead) {
      await broadcastPvdStart(sid);
    } else {
      try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
      // Head same: still inform clients to update tail order
      const set = pvdSidSockets.get(sid);
      if (set && set.size) {
        const msg = JSON.stringify({
          type: 'start',
          item: reordered[0] || null,
          queue: reordered,
          startedAt: pvdPlaybackState.get(sid)?.baseStartMs || null,
          paused: pvdPlaybackState.get(sid)?.paused || false,
          atSec: reordered[0] ? getCurrentAtSec(sid) : 0,
          elapsedSec: reordered[0] ? getCurrentPvdElapsedSec(sid) : 0,
          serverNow: Date.now(),
        });
        for (const ws of Array.from(set)) {
          try { if (ws.readyState === 1) ws.send(msg, { compress: false }); } catch { }
        }
      }
      scheduleNextPvdAutoPop(sid);
    }
    notifyPvdAdminSubscribers(sid, 'reordered').catch(() => null);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to reorder' });
  }
});

// POST delete specific item by id
app.post('/api/video-donation/delete', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const id = String(req.body?.id || '');
    if (!id) return res.status(400).json({ error: 'id required' });
    const q = getVideoQueue(sid);
    const idx = q.findIndex(it => String(it.id) === id);
    if (idx < 0) return res.status(404).json({ error: 'not_found' });
    const removingHead = idx === 0;
    q.splice(idx, 1);
    if (removingHead) {
      try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
      await broadcastPvdStart(sid);
    } else {
      notifyPvdAdminSubscribers(sid, 'deleted').catch(() => null);
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete item' });
  }
});

// POST delete specific item by id and refund its cost to requester
app.post('/api/video-donation/delete-refund', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const id = String(req.body?.id || '');
    if (!id) return res.status(400).json({ error: 'id required' });
    const q = getVideoQueue(sid);
    const idx = q.findIndex(it => String(it.id) === id);
    if (idx < 0) return res.status(404).json({ error: 'not_found' });
    const item = q[idx];
    const removingHead = idx === 0;
    // Refund cost to requester
    try {
      const uid = await resolveStreamerUidForSid(sid);
      if (uid && item?.userId && item?.cost) {
        const before = await getChannelPoints(uid, String(item.userId)).catch(() => null);
        await incrChannelPoints(uid, String(item.userId), item.username ? String(item.username) : null, Number(item.cost));
        await recordBotEventLogSafe(sid, {
          category: 'video_donation',
          eventType: 'video_donation_refund_delete',
          provider: 'admin',
          channelUid: uid,
          viewerUserId: String(item.userId),
          viewerName: item.username ? String(item.username) : null,
          pointDelta: Number(item.cost || 0),
          pointBefore: Number.isFinite(Number(before)) ? Number(before) : null,
          pointAfter: Number.isFinite(Number(before)) ? Number(before) + Number(item.cost || 0) : null,
          status: 'refunded',
          targetName: item.title || item.mediaId || item.mediaUrl || '영상 후원',
          summary: `영상 후원 삭제 후 포인트 반환: ${item.title || item.mediaId || '영상'} (+${Number(item.cost || 0)}P)`,
          metadata: {
            queueItemId: item.id || null,
            mediaProvider: item.mediaProvider || null,
            mediaId: item.mediaId || item.videoId || null,
            cost: Number(item.cost || 0),
            removedHead: removingHead,
          },
        });
      }
    } catch (e) {
      console.warn('[pvd:delete-refund] refund failed', e?.message || e);
    }
    // Remove from queue
    q.splice(idx, 1);
    if (removingHead) {
      try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
      await broadcastPvdStart(sid);
    } else {
      // Inform clients of tail change
      const set = pvdSidSockets.get(sid);
      if (set && set.size) {
        const msg = JSON.stringify({
          type: 'start',
          item: q[0] || null,
          queue: q,
          startedAt: pvdPlaybackState.get(sid)?.baseStartMs || null,
          paused: pvdPlaybackState.get(sid)?.paused || false,
          atSec: q[0] ? getCurrentAtSec(sid) : 0,
          elapsedSec: q[0] ? getCurrentPvdElapsedSec(sid) : 0,
          serverNow: Date.now(),
        });
        for (const ws of Array.from(set)) {
          try { if (ws.readyState === 1) ws.send(msg, { compress: false }); } catch { }
        }
      }
      notifyPvdAdminSubscribers(sid, 'deleted_refunded').catch(() => null);
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete-refund item' });
  }
});

function getVideoQueue(sid) {
  let q = videoDonationQueues.get(sid);
  if (!q) { q = []; videoDonationQueues.set(sid, q); }
  return q;
}

async function getPvdQueueSnapshot(sid, reason = 'sync') {
  const q = getVideoQueue(sid);
  const state = pvdPlaybackState.get(sid) || null;
  const current = q[0] || null;
  const volume = await getPvdVolumeForSid(sid).catch(() => 100);
  return {
    type: 'video-donation.queue',
    reason,
    items: q,
    currentItem: current,
    waitingItems: q.slice(1),
    queueSize: q.length,
    waitingSize: Math.max(0, q.length - 1),
    startedAt: current ? state?.baseStartMs || null : null,
    paused: current ? state?.paused === true : null,
    atSec: current ? getCurrentAtSec(sid) : 0,
    elapsedSec: current ? getCurrentPvdElapsedSec(sid) : 0,
    volume,
    serverNow: Date.now(),
  };
}

async function notifyPvdAdminSubscribers(sid, reason = 'queue_changed') {
  const set = pvdAdminSockets.get(sid);
  if (!set || !set.size) return;
  const payload = await getPvdQueueSnapshot(sid, reason).catch(() => null);
  if (!payload) return;
  const text = JSON.stringify(payload);
  for (const ws of Array.from(set)) {
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === 1) ws.send(text, { compress: false });
      else set.delete(ws);
    } catch {
      set.delete(ws);
    }
  }
  if (set.size === 0) pvdAdminSockets.delete(sid);
}

async function getPvdAdminSidFromRequest(req) {
  const byKey = await getPartitionIdByApiKey(req).catch(() => null);
  if (byKey) return byKey;
  const sidToken = getCookieSid(req);
  if (!sidToken) return null;
  const userId = await getSessionUserId(sidToken).catch(() => null);
  return userId ? `user:${String(userId)}` : null;
}

const TIKTOK_DURATION_SYNC_WAIT_MS = 20 * 1000;

// Playback state per sid for sync.
// baseStartMs is the wall-clock time when the current item started at item.startSec.
const pvdPlaybackState = new Map(); // sid -> { baseStartMs: number, paused: boolean, pausedAtSec: number|null }

function normalizePvdVolume(value, fallback = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(Number(fallback || 100))));
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function getPvdVolumeForSid(sid) {
  const settings = await getBotSettings(sid).catch(() => ({})) || {};
  return normalizePvdVolume(settings.videoDonationVolume ?? 100);
}

function getPvdItemStartSec(item) {
  return Math.max(0, Math.floor(Number(item?.startSec || 0)));
}

function getPvdPlayDurationSec({ maxDurationSec, ytDurationSec = null, startSec = 0, playSec = null } = {}) {
  const maxDur = Math.max(1, Math.floor(Number(maxDurationSec || 600)));
  const start = Math.max(0, Math.floor(Number(startSec || 0)));
  const explicitPlay = Number(playSec);
  const play = Number.isFinite(explicitPlay) && explicitPlay > 0 ? Math.floor(explicitPlay) : null;
  const fullDuration = Number(ytDurationSec);
  const remainingFromStart = Number.isFinite(fullDuration) && fullDuration > 0
    ? Math.max(1, Math.floor(fullDuration) - start)
    : 1;
  const requestedDuration = play != null ? play : remainingFromStart;
  return Math.max(1, Math.min(maxDur, requestedDuration));
}

function createPvdPlaybackState(item) {
  return {
    baseStartMs: Date.now(),
    paused: false,
    pausedAtSec: null,
    durationWaitStartedAtMs: item?.awaitDurationSync ? Date.now() : null,
  };
}

function getPvdQueueItemKey(item) {
  return String(item?.id || `${item?.mediaProvider || 'unknown'}:${item?.mediaId || item?.videoId || item?.mediaUrl || item?.embedUrl || ''}:${item?.ts || item?.createdAt || ''}`);
}

async function popCurrentVideoDonationItem(sid, options = {}) {
  const q = getVideoQueue(sid);
  const head = q[0] || null;
  const expectedItemId = String(options.expectedItemId || '').trim();
  if (!head) return { popped: null, queue: q, empty: true };
  if (expectedItemId && String(head.id || '') !== expectedItemId && getPvdQueueItemKey(head) !== expectedItemId) {
    return { popped: null, queue: q, head, mismatch: true };
  }

  const popped = q.shift() || null;
  if (popped && options.refundOnError && String(options.cause || '').toLowerCase() === 'error') {
    try {
      const uid = await resolveStreamerUidForSid(sid);
      if (uid && popped.userId && popped.cost) {
        await incrChannelPoints(uid, String(popped.userId), popped.username ? String(popped.username) : null, Number(popped.cost));
      }
    } catch (e) {
      console.warn('[pvd:refund] failed', e?.message || e);
    }
  }
  return { popped, queue: q };
}

function setPvdPlaybackBaseFromAtSec(state, item, atSec) {
  const startSec = getPvdItemStartSec(item);
  const safeAtSec = Math.max(startSec, Math.floor(Number(atSec || startSec)));
  const elapsedSec = Math.max(0, safeAtSec - startSec);
  state.baseStartMs = Date.now() - elapsedSec * 1000;
}

function getCurrentAtSec(sid) {
  const state = pvdPlaybackState.get(sid);
  const q = getVideoQueue(sid);
  const item = q[0] || null;
  if (!item || !state) return 0;
  if (state.paused && state.pausedAtSec != null) return Math.max(0, Math.floor(Number(state.pausedAtSec)));
  const elapsedSec = Math.max(0, Math.floor((Date.now() - Number(state.baseStartMs || Date.now())) / 1000));
  const at = getPvdItemStartSec(item) + elapsedSec;
  return Math.max(0, at);
}

function getCurrentPvdElapsedSec(sid) {
  const q = getVideoQueue(sid);
  const item = q[0] || null;
  if (!item) return 0;
  return Math.max(0, getCurrentAtSec(sid) - getPvdItemStartSec(item));
}

function updateCurrentPvdDurationFromPlayer(sid, durationSec) {
  const q = getVideoQueue(sid);
  const item = q[0] || null;
  const fullDuration = Number(durationSec);
  if (!item || !Number.isFinite(fullDuration) || fullDuration <= 0) return null;
  const start = getPvdItemStartSec(item);
  const remainingFromStart = Math.max(1, Math.ceil(fullDuration) - start);
  const currentDuration = Number(item.durationSec || 0);
  const nextDuration = currentDuration > 2
    ? Math.min(Math.ceil(currentDuration), remainingFromStart)
    : remainingFromStart;
  if (!Number.isFinite(nextDuration) || nextDuration <= 0) return null;
  if (Math.abs(Number(item.durationSec || 0) - nextDuration) < 0.5) return item;
  item.durationSec = nextDuration;
  item.mediaDurationSec = Math.ceil(fullDuration);
  item.awaitDurationSync = false;
  item.updatedAt = Date.now();
  try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
  scheduleNextPvdAutoPop(sid);
  notifyPvdAdminSubscribers(sid, 'duration_synced').catch(() => null);
  return item;
}

async function refreshChzzkClipPlaybackForItem(item) {
  if (!item || String(item.mediaProvider || '').toLowerCase() !== 'chzzk_clip' || !item.mediaId) return item;
  const clip = await fetchChzzkClipInfo(item.mediaId).catch(() => null);
  if (!clip) {
    if (/chzzk\.naver\.com\/embed\/clip\//i.test(String(item.embedUrl || ''))) item.embedUrl = null;
    return item;
  }
  if (clip.playbackUrl) {
    item.embedUrl = clip.playbackUrl;
  } else if (/chzzk\.naver\.com\/embed\/clip\//i.test(String(item.embedUrl || ''))) {
    item.embedUrl = null;
  }
  if (clip.title && (!item.title || isChzzkClipFallbackTitle(item.title, item.mediaId))) item.title = clip.title;
  if (clip.thumbnailUrl && !item.thumbnailUrl) item.thumbnailUrl = clip.thumbnailUrl;
  if (Number.isFinite(Number(clip.durationSec)) && Number(clip.durationSec) > 0) {
    item.mediaDurationSec = Math.ceil(Number(clip.durationSec));
    item.durationSec = getPvdPlayDurationSec({
      maxDurationSec: item.maxDurationSec || item.durationSec || clip.durationSec,
      ytDurationSec: clip.durationSec,
      startSec: item.startSec,
      playSec: item.requestedPlaySec,
    });
    item.awaitDurationSync = false;
    item.durationSyncTimedOut = false;
  }
  item.updatedAt = Date.now();
  return item;
}

function isChzzkClipFallbackTitle(title, mediaId) {
  const text = String(title || '').trim();
  const id = String(mediaId || '').trim();
  if (!text) return true;
  if (id && text === `CHZZK 클립 ${id}`) return true;
  return /^CHZZK 클립\s+[A-Za-z0-9_-]+$/i.test(text) || text === '제목을 불러오지 못한 치지직 클립';
}

async function broadcastPvdControl(sid, message) {
  const payload = { type: 'control', ...message, serverNow: Date.now() };
  await broadcastToChannelBySid(sid, 'pvd', payload).catch(() => null);
  const set = pvdSidSockets.get(sid);
  const text = JSON.stringify(payload);
  if (set && set.size) {
    for (const ws of Array.from(set)) {
      try { if (ws.readyState === 1) ws.send(text, { compress: false }); } catch { }
    }
  }
  notifyPvdAdminSubscribers(sid, payload.op === 'volume' ? 'volume_changed' : 'playback_control').catch(() => null);
  return payload;
}

// Local random token generator for PVD viewer tokens
function pvdRandomToken(len = 24) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function pvdDeterministicTokenFromUid(uid) {
  try {
    const secret = process.env.PVD_TOKEN_SECRET || '';
    if (!uid || !secret) return null;
    const h = crypto.createHmac('sha256', String(secret)).update(String(uid)).digest('base64url');
    // Make it URL friendly and reasonably short
    return `pv_${h.slice(0, 32)}`;
  } catch {
    return null;
  }
}

function scheduleNextPvdAutoPop(sid) {
  try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
  const q = getVideoQueue(sid);
  const item = q[0];
  if (!item) return;
  let state = pvdPlaybackState.get(sid);
  if (!state) {
    state = createPvdPlaybackState(item);
    pvdPlaybackState.set(sid, state);
  }
  // If paused, do not schedule auto-pop
  if (state.paused) return;
  if (item.awaitDurationSync && !item.mediaDurationSec) {
    if (!state.durationWaitStartedAtMs) state.durationWaitStartedAtMs = Date.now();
    const waitedMs = Math.max(0, Date.now() - Number(state.durationWaitStartedAtMs || Date.now()));
    const remainingWaitMs = TIKTOK_DURATION_SYNC_WAIT_MS - waitedMs;
    if (remainingWaitMs > 0) {
      const timer = setTimeout(() => {
        scheduleNextPvdAutoPop(sid);
      }, Math.max(500, remainingWaitMs));
      videoDonationTimers.set(sid, timer);
      return;
    }
    item.awaitDurationSync = false;
    item.durationSyncTimedOut = true;
    item.updatedAt = Date.now();
  }
  // Compute remaining based on current position
  const elapsedSec = getCurrentPvdElapsedSec(sid);
  const total = Math.max(1, Number(item.durationSec || 0));
  const remaining = Math.max(0.5, total - elapsedSec);
  const ms = Math.max(500, remaining * 1000);
  const scheduledItemKey = getPvdQueueItemKey(item);
  const timer = setTimeout(async () => {
    try {
      // Confirm head unchanged and not paused before popping
      const head = getVideoQueue(sid)[0];
      const st = pvdPlaybackState.get(sid);
      if (!head || (st && st.paused)) return; // safety check
      if (getPvdQueueItemKey(head) !== scheduledItemKey) {
        return;
      }
      // Extra guard: if we haven't really reached end, delay
      const curElapsed = getCurrentPvdElapsedSec(sid);
      if (curElapsed < Math.max(1, Number(head.durationSec || 0)) - 0.5) {
        return scheduleNextPvdAutoPop(sid);
      }
      const result = await popCurrentVideoDonationItem(sid, { cause: 'auto_timer', expectedItemId: scheduledItemKey });
      if (result.popped) await broadcastPvdStart(sid);
    } catch (e) {
      console.warn('[pvd:autoPop] failed', e?.message || e);
    }
  }, ms);
  videoDonationTimers.set(sid, timer);
}

async function broadcastPvdStart(sid) {
  try {
    const q = getVideoQueue(sid);
    const volume = await getPvdVolumeForSid(sid);

    // Rebase playback state when a new head starts
    if (q[0]) {
      await refreshChzzkClipPlaybackForItem(q[0]);
      pvdPlaybackState.set(sid, createPvdPlaybackState(q[0]));
    } else {
      pvdPlaybackState.delete(sid);
    }

    const message = {
      type: 'start',
      item: q[0] || null,
      queue: q,
      startedAt: q[0] ? pvdPlaybackState.get(sid)?.baseStartMs || null : null,
      paused: q[0] ? false : null,
      atSec: q[0] ? getCurrentAtSec(sid) : 0,
      elapsedSec: q[0] ? getCurrentPvdElapsedSec(sid) : 0,
      volume,
      serverNow: Date.now()
    };

    const result = await broadcastToChannelBySid(sid, 'pvd', message);

    const set = pvdSidSockets.get(sid);
    if (set && set.size > 0) {
      const msg = JSON.stringify(message);
      for (const ws of Array.from(set)) {
        try { if (ws.readyState === 1) { ws.send(msg, { compress: false }); } } catch { }
      }
    }

    console.log(`[PVD Broadcast] Start message sent to ${result.success} connections in channel`);
    notifyPvdAdminSubscribers(sid, 'playback_started').catch(() => null);

    // Reschedule timer for new head
    try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
    scheduleNextPvdAutoPop(sid);

  } catch (error) {
    console.error('[PVD Broadcast] Error in broadcastPvdStart:', error);

    const set = pvdSidSockets.get(sid);
    if (set && set.size > 0) {
      const q = getVideoQueue(sid);
      const volume = await getPvdVolumeForSid(sid).catch(() => 100);
      const msg = JSON.stringify({
        type: 'start',
        item: q[0] || null,
        queue: q,
        startedAt: q[0] ? pvdPlaybackState.get(sid)?.baseStartMs || null : null,
        paused: q[0] ? false : null,
        volume
      });
      for (const ws of Array.from(set)) {
        try { if (ws.readyState === 1) { ws.send(msg, { compress: false }); } } catch { }
      }
    }
    notifyPvdAdminSubscribers(sid, 'playback_started').catch(() => null);
  }
}

// Diagnostics: check active server instance/version
app.get('/api/version', (req, res) => {
  res.json({
    ok: true,
    role: PROCESS_ROLE,
    dbProvider: DB_PROVIDER,
    releaseSha: RELEASE_SHA,
    startedAt: SERVER_STARTED_AT,
    wsPvdPerMessageDeflate: false,
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    role: PROCESS_ROLE,
    dbProvider: DB_PROVIDER,
    releaseSha: RELEASE_SHA,
    uptimeSec: Math.round(process.uptime()),
    startedAt: SERVER_STARTED_AT,
  });
});

app.get(['/healthz', '/readyz'], (req, res) => {
  const memory = process.memoryUsage();
  res.json({
    ok: true,
    role: PROCESS_ROLE,
    dbProvider: DB_PROVIDER,
    releaseSha: RELEASE_SHA,
    uptimeSec: Math.round(process.uptime()),
    startedAt: SERVER_STARTED_AT,
    memory: {
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      rssMb: Math.round(memory.rss / 1024 / 1024),
    },
    sessions: {
      live: liveSession?.size || 0,
      cime: typeof cimeSessionStore !== 'undefined' ? cimeSessionStore.size : 0,
      youtube: typeof youtubeSessionStore !== 'undefined' ? youtubeSessionStore.size : 0,
    },
    db: getPgPoolStatus(),
  });
});

// Send a command to desktop clients via API key
// POST /api/desktop/command
// Authorization: Bearer <API_KEY>  OR  body.token / query.token
app.post('/api/desktop/command', rateLimiters.apiKeyCommand, async (req, res) => {
  try {
    const auth = String(req.headers?.authorization || '').trim();
    let token = '';
    if (auth.toLowerCase().startsWith('bearer ')) token = auth.slice(7).trim();
    if (!token) token = String(req.query?.token || req.body?.token || '');
    if (!token) return res.status(401).json({ error: 'token required' });

    const pid = await getOwnerPidForApiKey(token);
    if (!pid) return res.status(403).json({ error: 'invalid token' });

    const command = String(req.body?.command || '').trim();
    const args = Array.isArray(req.body?.args) ? req.body.args : (req.body?.args ? [req.body.args] : []);
    if (!command) return res.status(400).json({ error: 'command required' });

    const payload = { type: 'command', command, args, serverNow: Date.now() };
    const delivered = broadcastToDesktop(pid, payload);
    try { await touchApiKeyLastUsed(token); } catch { }
    return res.json({ ok: true, delivered });
  } catch (e) {
    return res.status(500).json({ error: 'failed', detail: e?.message || String(e) });
  }
});

// GET settings (PVD)
app.get('/api/video-donation/settings', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const settings = await getBotSettings(sid) || {};
    const pps = Math.max(0, Number(settings.videoDonationPointsPerSecond ?? 1));
    const enabled = settings.videoDonationAcceptEnabled === true;
    const maxDur = Math.max(1, Number(settings.videoDonationMaxDurationSec ?? 600));
    const perUserLimit = Math.max(0, Number(settings.videoDonationPerUserQueueLimit ?? 0));
    const volume = normalizePvdVolume(settings.videoDonationVolume ?? 100);
    const providers = normalizePvdProviders(settings.videoDonationProviders);
    return res.json({ pointsPerSecond: pps, acceptEnabled: enabled, maxDurationSec: maxDur, perUserLimit, volume, providers });
  } catch (e) {
    console.error('[pvd:settings:get] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Public: viewer reports that current video ended/errored, pop head by token
app.post('/api/video-donation/pop-by-token', async (req, res) => {
  try {
    const token = String(req.body?.token || '');
    if (!token) return res.status(400).json({ error: 'token required' });
    // Resolve sid from token
    let sid = pvdTokenToSid.get(token) || null;
    if (!sid) {
      try { sid = await findSidByViewerToken(token); if (sid) pvdTokenToSid.set(token, sid); } catch { }
    }
    if (!sid) return res.status(404).json({ error: 'token not found' });
    // Verify against current settings to reject revoked tokens
    try {
      const s = await getBotSettings(sid) || {};
      if (!s.videoDonationViewerToken || s.videoDonationViewerToken !== token) return res.status(404).json({ error: 'token not found' });
    } catch { }

    const cause = String(req.body?.cause || '').toLowerCase();
    const expectedItemId = String(req.body?.itemId || req.body?.expectedItemId || '').trim();
    const { popped, queue, mismatch, head } = await popCurrentVideoDonationItem(sid, {
      cause,
      expectedItemId,
      refundOnError: true,
    });
    // Broadcast next (or null) to all viewers
    if (popped) {
      try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
      await broadcastPvdStart(sid);
    }
    return res.json({ item: popped, queue, mismatch: mismatch === true, currentItem: head || queue[0] || null });
  } catch (e) {
    return res.status(500).json({ error: 'failed' });
  }
});

// Resolve YouTube title/duration for a given url or id (helper for clients)
app.get('/api/video-donation/resolve-title', rateLimiters.externalLookup, async (req, res) => {
  try {
    const q = String(req.query?.url || req.query?.id || req.query?.q || '');
    if (!q) return res.status(400).json({ error: 'url, id or q required' });
    const sid = await getPartitionId(req, res).catch(() => null);
    const settings = sid ? (await getBotSettings(sid).catch(() => ({})) || {}) : { videoDonationProviders: getDefaultPvdProviders() };
    const info = await resolvePvdMedia(q, settings, { allowSearch: true });
    return res.json({
      provider: info.provider,
      mediaId: info.mediaId,
      title: info.title || null,
      durationSec: Number.isFinite(info.durationSec) ? Number(info.durationSec) : null,
      thumbnailUrl: info.thumbnailUrl || null,
      embedUrl: info.embedUrl || null,
    });
  } catch (e) {
    if (e?.code === 'provider_disabled') return res.status(400).json({ error: 'provider_disabled', provider: e.provider });
    if (e?.code === 'clip_playback_unavailable') {
      logChzzkClipPlaybackFailure('resolve-title', e);
      return res.status(404).json({ error: 'clip_playback_unavailable', provider: e.provider, reason: e.reason || null });
    }
    if (e?.code === 'unsupported_media') return res.status(404).json({ error: 'not_found' });
    return res.status(500).json({ error: 'failed' });
  }
});

// POST settings
app.post('/api/video-donation/settings', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const body = req.body || {};
    const pps = Math.max(0, Number(body.pointsPerSecond ?? 1));
    const enabled = body.acceptEnabled === true;
    const maxDur = Math.max(1, Number(body.maxDurationSec ?? 600));
    const perUserLimit = Math.max(0, Number(body.perUserLimit ?? 0));
    const volume = normalizePvdVolume(body.volume ?? 100);
    const settings = await getBotSettings(sid) || {};
    const providers = normalizePvdProviders(body.providers || body.videoDonationProviders || settings.videoDonationProviders);
    const next = { ...settings, videoDonationPointsPerSecond: pps, videoDonationAcceptEnabled: enabled, videoDonationMaxDurationSec: maxDur, videoDonationPerUserQueueLimit: perUserLimit, videoDonationVolume: volume, videoDonationProviders: providers };
    await setBotSettings(sid, next);
    await broadcastPvdControl(sid, { op: 'volume', volume }).catch(() => null);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[pvd:settings:post] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to save settings' });
  }
});

// POST request: enqueue a video donation request, deduct points
// body: { videoUrl, title?, startSec?, playSec?, requesterUserId, requesterUsername }
app.post('/api/video-donation/request', rateLimiters.userWrite, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const settings = await getBotSettings(sid) || {};
    const enabled = settings.videoDonationAcceptEnabled === true;
    if (!enabled) return res.status(400).json({ error: 'Video donation is disabled' });
    const pps = Math.max(0, Number(settings.videoDonationPointsPerSecond ?? 1));
    const maxDur = Math.max(1, Number(settings.videoDonationMaxDurationSec ?? 600));
    const perUserLimit = Math.max(0, Number(settings.videoDonationPerUserQueueLimit ?? 0));
    let { videoUrl, title, startSec, playSec, requesterUserId, requesterUsername } = req.body || {};
    const input = String(videoUrl || '').trim();
    let media;
    try {
      media = await resolvePvdMedia(input, settings, { allowSearch: true });
    } catch (e) {
      if (e?.code === 'provider_disabled') return res.status(400).json({ error: 'provider_disabled', provider: e.provider, message: `${getPvdProviderLabel(e.provider)} 요청은 꺼져 있습니다.` });
      if (e?.code === 'clip_playback_unavailable') {
        logChzzkClipPlaybackFailure('request', e);
        return res.status(400).json({ error: 'clip_playback_unavailable', reason: e.reason || null, message: '치지직 클립 mp4를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
      }
      return res.status(400).json({ error: 'unsupported_media', message: '지원하지 않는 링크입니다.' });
    }
    const start = Math.max(0, Number(startSec || 0) || 0);
    const play = Number.isFinite(Number(playSec)) && Number(playSec) > 0 ? Math.floor(Number(playSec)) : null;
    const dur = getPvdPlayDurationSec({ maxDurationSec: maxDur, ytDurationSec: media.durationSec, startSec: start, playSec: play });
    const awaitDurationSync = shouldAwaitPvdDurationSync(media.provider, media.durationSec, play);
    const cost = Math.ceil(pps * dur);

    // Deduct points
    const uid = await resolveStreamerUidForSid(sid);
    if (!uid) return res.status(400).json({ error: 'No channel UID' });
    const userId = String(requesterUserId || '').trim();
    const username = requesterUsername ? String(requesterUsername) : null;
    if (!userId) return res.status(400).json({ error: 'requesterUserId required' });
    const blocked = findBlockedBotUser(settings, userId, null);
    if (blocked) return res.status(403).json({ error: 'blocked_user', message: '이 방송에서는 봇 기능을 사용할 수 없습니다.' });
    // Enforce per-user queue limit (0 means unlimited)
    try {
      if (perUserLimit > 0) {
        const q = getVideoQueue(sid);
        const currentCount = q.filter(it => String(it?.userId || '') === userId).length;
        if (currentCount >= perUserLimit) {
          // Notify via CHZZK chat about the limit hit (best-effort)
          try {
            let sessionKey = null;
            try { const entry = sessionStore.get(sid) || await ensureSession(sid); sessionKey = entry?.sessionKey || null; } catch { }
            let token = null;
            try { token = await getValidAccessToken(sid); } catch { }
            if (sessionKey && token) {
              const url = `${OPENAPI_BASE}/open/v1/chats/send`;
              const message = `1인당 대기열 제한으로 요청에 실패했습니다. (현재 ${perUserLimit}개)`;
              await axios.post(url, { message }, {
                params: { sessionKey },
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
              });
            }
          } catch { }
          return res.status(400).json({ error: 'queue_limit_reached', limit: perUserLimit });
        }
      }
    } catch { }
    // Check balance first
    const currentPts = await getChannelPoints(uid, userId).catch(() => 0);
    if (Number(currentPts || 0) < cost) {
      return res.status(400).json({ error: 'insufficient_points', need: cost, have: Number(currentPts || 0) });
    }
    await incrChannelPoints(uid, userId, username, -cost);

    // Enqueue
    const q = getVideoQueue(sid);
    const shouldStartPlayback = q.length === 0;
    const item = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      mediaProvider: media.provider,
      mediaId: media.mediaId,
      mediaUrl: media.mediaUrl,
      embedUrl: media.embedUrl,
      thumbnailUrl: media.thumbnailUrl || null,
      videoId: media.provider === 'youtube' ? media.mediaId : null,
      title: title || media.title || null,
      durationSec: dur,
      mediaDurationSec: Number.isFinite(Number(media.durationSec)) ? Math.ceil(Number(media.durationSec)) : null,
      awaitDurationSync,
      startSec: start,
      requestedPlaySec: play,
      maxDurationSec: maxDur,
      cost,
      userId,
      username: username || null,
      status: 'queued'
    };
    q.push(item);
    await recordBotEventLogSafe(sid, {
      category: 'video_donation',
      eventType: 'video_donation_request',
      provider: 'viewer',
      channelUid: uid,
      viewerUserId: userId,
      viewerName: username || null,
      pointDelta: -cost,
      pointBefore: Number(currentPts || 0),
      pointAfter: Number(currentPts || 0) - cost,
      targetName: item.title || item.mediaId || item.mediaUrl || '영상 후원',
      summary: `영상 후원 신청: ${item.title || item.mediaId || item.mediaUrl || '영상'} (${cost}P 사용)`,
      metadata: {
        mediaProvider: item.mediaProvider,
        mediaId: item.mediaId,
        mediaUrl: item.mediaUrl,
        embedUrl: item.embedUrl,
        thumbnailUrl: item.thumbnailUrl,
        title: item.title,
        durationSec: item.durationSec,
        mediaDurationSec: item.mediaDurationSec,
        awaitDurationSync: item.awaitDurationSync,
        startSec: item.startSec,
        requestedPlaySec: item.requestedPlaySec,
        maxDurationSec: item.maxDurationSec,
        cost,
        queueItemId: item.id,
        replaySnapshot: item,
      },
    });
    // If this is the first item, broadcast start & schedule auto pop
    if (shouldStartPlayback) {
      await broadcastPvdStart(sid);
    } else {
      notifyPvdAdminSubscribers(sid, 'queued').catch(() => null);
    }
    return res.json({ ok: true, item });
  } catch (e) {
    console.error('[pvd:request] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to enqueue request' });
  }
});

// GET queue list
app.get('/api/video-donation/queue', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const q = getVideoQueue(sid);
    return res.json({ items: q });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to get queue' });
  }
});

// Public: current PVD item for OBS/browser viewers.
// The legacy React viewer already calls this endpoint as an HTTP fallback.
app.get('/api/video-donation/now-playing', async (req, res) => {
  try {
    const token = String(req.query?.token || '').trim();
    if (!token) return res.status(400).json({ error: 'token required' });

    let sid = pvdTokenToSid.get(token) || null;
    if (!sid) {
      try {
        sid = await findSidByViewerToken(token);
        if (sid) pvdTokenToSid.set(token, sid);
      } catch { }
    }
    if (!sid) return res.status(404).json({ error: 'token not found' });

    let settings = {};
    try {
      settings = await getBotSettings(sid) || {};
      if (!settings.videoDonationViewerToken || settings.videoDonationViewerToken !== token) {
        return res.status(404).json({ error: 'token not found' });
      }
    } catch { }

    const q = getVideoQueue(sid);
    if (q[0]) await refreshChzzkClipPlaybackForItem(q[0]);
    const state = pvdPlaybackState.get(sid) || null;
    res.set('Cache-Control', 'no-store, max-age=0');
    return res.json({
      item: q[0] || null,
      queue: q,
      startedAt: state?.baseStartMs || null,
      paused: state?.paused === true,
      atSec: getCurrentAtSec(sid),
      elapsedSec: getCurrentPvdElapsedSec(sid),
      volume: normalizePvdVolume(settings.videoDonationVolume ?? 100),
      serverNow: Date.now()
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to get now playing' });
  }
});

// POST pop next
app.post('/api/video-donation/pop', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const cause = String(req.body?.cause || '').toLowerCase();
    const expectedItemId = String(req.body?.itemId || req.body?.expectedItemId || '').trim();
    const { popped, queue, mismatch, head } = await popCurrentVideoDonationItem(sid, {
      cause,
      expectedItemId,
      refundOnError: true,
    });
    // if popping current, schedule next and broadcast
    if (popped) {
      try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
      await broadcastPvdStart(sid);
    }
    return res.json({ item: popped, queue, mismatch: mismatch === true, currentItem: head || queue[0] || null });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to pop queue' });
  }
});

// GET viewer URL
app.get('/api/video-donation/viewer-url', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const settings = await getBotSettings(sid) || {};
    let uid = null;
    try { uid = await resolveStreamerUidForSid(sid); } catch { }
    let token = uid ? await getOrCreateViewerTokenSupabase(uid, 'pvd', sid, 'pvd').catch(() => null) : null;
    if (!token) token = settings.videoDonationViewerToken;
    if (!token) {
      // Prefer deterministic token if secret + uid available
      let stable = null;
      try { if (uid) stable = pvdDeterministicTokenFromUid(uid); } catch { }
      token = stable || pvdRandomToken();
      const next = { ...settings, videoDonationViewerToken: token };
      await setBotSettings(sid, next);
    } else if (settings.videoDonationViewerToken !== token) {
      try { await setBotSettings(sid, { ...settings, videoDonationViewerToken: token }); } catch { }
    }
    // update reverse index
    if (token) pvdTokenToSid.set(token, sid);
    // Public viewer path uses frontend route
    const path = `/pvd/${encodeURIComponent(token)}`;
    return res.json({ sid, token, path });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to get viewer url' });
  }
});

// Rotate viewer token explicitly (admin only). Old tokens become invalid immediately.
app.post('/api/video-donation/rotate-viewer-token', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const settings = await getBotSettings(sid) || {};
    let uid = null;
    try { uid = await resolveStreamerUidForSid(sid); } catch { }
    let token = uid ? await rotateViewerTokenSupabase(uid, 'pvd', sid, 'pvd').catch(() => null) : null;
    if (!token) token = pvdRandomToken();
    const next = { ...settings, videoDonationViewerToken: token };
    await setBotSettings(sid, next);
    // refresh reverse index
    try { pvdTokenToSid.set(token, sid); } catch { }
    return res.json({ ok: true, token, path: `/pvd/${encodeURIComponent(token)}` });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to rotate token' });
  }
});

app.get('/api/bot/blocked-users', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const settings = await getBotSettings(sid) || {};
    return res.json({ items: normalizeBlockedBotUsers(settings.blockedBotUsers) });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load blocked users' });
  }
});

app.post('/api/bot/blocked-users', rateLimiters.userWrite, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const settings = await getBotSettings(sid) || {};
    const userId = String(req.body?.userId || '').trim();
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const items = normalizeBlockedBotUsers(settings.blockedBotUsers).filter((item) => item.userId.toLowerCase() !== userId.toLowerCase());
    items.unshift({
      userId,
      username: String(req.body?.username || '').trim() || null,
      reason: String(req.body?.reason || '').trim() || null,
      createdAt: new Date().toISOString(),
    });
    await setBotSettings(sid, { ...settings, blockedBotUsers: items.slice(0, 500) });
    return res.json({ ok: true, items: items.slice(0, 500) });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to block user' });
  }
});

app.delete('/api/bot/blocked-users/:userId', rateLimiters.userWrite, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const settings = await getBotSettings(sid) || {};
    const userId = decodeURIComponent(String(req.params.userId || '')).trim();
    const keys = buildBotUserBlockKeys(userId);
    const items = normalizeBlockedBotUsers(settings.blockedBotUsers).filter((item) => {
      const itemKeys = buildBotUserBlockKeys(item.userId);
      for (const key of itemKeys) if (keys.has(key)) return false;
      return true;
    });
    await setBotSettings(sid, { ...settings, blockedBotUsers: items });
    return res.json({ ok: true, items });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to unblock user' });
  }
});

app.get('/api/drawing-donation/settings', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const settings = await getBotSettings(sid) || {};
    return res.json({ settings: normalizeDrawingDonationSettings(settings.drawingDonation) });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load drawing donation settings' });
  }
});

app.post('/api/drawing-donation/settings', rateLimiters.userWrite, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const settings = await getBotSettings(sid) || {};
    const drawingDonation = normalizeDrawingDonationSettings(req.body || {});
    await setBotSettings(sid, { ...settings, drawingDonation });
    notifyDrawingAdminSubscribers(sid, 'settings_updated').catch(() => null);
    return res.json({ ok: true, settings: drawingDonation });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to save drawing donation settings' });
  }
});

app.get('/api/drawing-donation/queue', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    return res.json({ items: await listDrawingQueueForSid(sid) });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load drawing donation queue' });
  }
});

app.get('/api/drawing-donation/items/:id', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const id = decodeURIComponent(String(req.params.id || '')).trim();
    const item = await getDrawingItemForSid(sid, id, { includeStrokes: true });
    if (!item) return res.status(404).json({ error: 'not_found' });
    return res.json({ item });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load drawing donation item' });
  }
});

app.post('/api/drawing-donation/approve', rateLimiters.userWrite, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const id = String(req.body?.id || '').trim();
    const item = await updateDrawingItemStatusForSid(sid, id, 'approved');
    if (!item) return res.status(404).json({ error: 'not_found' });
    await recordBotEventLogSafe(sid, {
      category: 'drawing_donation',
      eventType: 'drawing_donation_approve',
      provider: 'admin',
      channelUid: item.channelUid,
      viewerUserId: item.viewerUserId,
      viewerName: item.viewerName,
      pointDelta: 0,
      targetName: '그림 후원',
      summary: '그림 후원을 승인',
      status: 'success',
      metadata: { drawingId: item.id },
    });
    notifyDrawingSubscribers(sid, 'approved').catch(() => null);
    notifyDrawingAdminSubscribers(sid, 'approved').catch(() => null);
    return res.json({ ok: true, item });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to approve drawing donation' });
  }
});

app.post('/api/drawing-donation/reject', rateLimiters.userWrite, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const id = String(req.body?.id || '').trim();
    let item = await getDrawingItemForSid(sid, id, { includeStrokes: true });
    if (!item) return res.status(404).json({ error: 'not_found' });
    let refundedAmount = 0;
    if (!item.pointRefunded) {
      for (const deduction of item.pointDeductions || []) {
        await incrChannelPoints(item.channelUid, deduction.userId, deduction.username || item.viewerName || null, Number(deduction.amount || 0)).catch(() => null);
        refundedAmount += Number(deduction.amount || 0);
      }
      item.pointRefunded = true;
    }
    item = await updateDrawingItemStatusForSid(sid, id, 'rejected', { pointRefunded: true }) || item;
    if (refundedAmount > 0) {
      await recordBotEventLogSafe(sid, {
        category: 'drawing_donation',
        eventType: 'drawing_donation_reject_refund',
        provider: 'admin',
        channelUid: item.channelUid,
        viewerUserId: item.viewerUserId,
        viewerName: item.viewerName,
        pointDelta: refundedAmount,
        targetName: '그림 후원',
        summary: `그림 후원을 거절하고 ${refundedAmount}P를 반환`,
        status: 'refunded',
        metadata: { drawingId: item.id },
      });
    }
    notifyDrawingSubscribers(sid, 'rejected').catch(() => null);
    notifyDrawingAdminSubscribers(sid, 'rejected').catch(() => null);
    return res.json({ ok: true, item });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to reject drawing donation' });
  }
});

app.post('/api/drawing-donation/delete', rateLimiters.userWrite, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const id = String(req.body?.id || '').trim();
    const item = await deleteDrawingItemForSid(sid, id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    await recordBotEventLogSafe(sid, {
      category: 'drawing_donation',
      eventType: 'drawing_donation_delete',
      provider: 'admin',
      channelUid: item.channelUid,
      viewerUserId: item.viewerUserId,
      viewerName: item.viewerName,
      pointDelta: 0,
      targetName: '그림 후원',
      summary: '그림 후원을 대기열에서 삭제',
      status: 'deleted',
      metadata: { drawingId: item.id },
    });
    notifyDrawingSubscribers(sid, 'deleted').catch(() => null);
    notifyDrawingAdminSubscribers(sid, 'deleted').catch(() => null);
    return res.json({ ok: true, item });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete drawing donation' });
  }
});

app.post('/api/drawing-donation/delete-refund', rateLimiters.userWrite, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const id = String(req.body?.id || '').trim();
    let item = await getDrawingItemForSid(sid, id, { includeStrokes: true });
    if (!item) return res.status(404).json({ error: 'not_found' });
    let refundedAmount = 0;
    if (!item.pointRefunded) {
      for (const deduction of item.pointDeductions || []) {
        await incrChannelPoints(item.channelUid, deduction.userId, deduction.username || item.viewerName || null, Number(deduction.amount || 0)).catch(() => null);
        refundedAmount += Number(deduction.amount || 0);
      }
      item.pointRefunded = true;
    }
    item = await deleteDrawingItemForSid(sid, id) || item;
    if (refundedAmount > 0) {
      await recordBotEventLogSafe(sid, {
        category: 'drawing_donation',
        eventType: 'drawing_donation_delete_refund',
        provider: 'admin',
        channelUid: item.channelUid,
        viewerUserId: item.viewerUserId,
        viewerName: item.viewerName,
        pointDelta: refundedAmount,
        targetName: '그림 후원',
        summary: `그림 후원을 삭제하고 ${refundedAmount}P를 반환`,
        status: 'refunded',
        metadata: { drawingId: item.id },
      });
    }
    notifyDrawingSubscribers(sid, 'deleted_refunded').catch(() => null);
    notifyDrawingAdminSubscribers(sid, 'deleted_refunded').catch(() => null);
    return res.json({ ok: true, item });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete and refund drawing donation' });
  }
});

app.post('/api/drawing-donation/moderate-block', rateLimiters.userWrite, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const id = String(req.body?.id || '').trim();
    const reason = String(req.body?.reason || '그림 후원 검수 차단').trim();
    let item = await getDrawingItemForSid(sid, id, { includeStrokes: true });
    if (!item) return res.status(404).json({ error: 'not_found' });

    let refundedAmount = 0;
    if (!item.pointRefunded) {
      for (const deduction of item.pointDeductions || []) {
        await incrChannelPoints(item.channelUid, deduction.userId, deduction.username || item.viewerName || null, Number(deduction.amount || 0)).catch(() => null);
        refundedAmount += Number(deduction.amount || 0);
      }
      item.pointRefunded = true;
    }

    const settings = await getBotSettings(sid) || {};
    const userId = String(item.viewerUserId || '').trim();
    if (userId) {
      const items = normalizeBlockedBotUsers(settings.blockedBotUsers).filter((entry) => entry.userId.toLowerCase() !== userId.toLowerCase());
      items.unshift({
        userId,
        username: item.viewerName || null,
        reason,
        createdAt: new Date().toISOString(),
      });
      await setBotSettings(sid, { ...settings, blockedBotUsers: items.slice(0, 500) });
    }

    item = await updateDrawingItemStatusForSid(sid, id, 'rejected', { pointRefunded: true }) || item;
    await recordBotEventLogSafe(sid, {
      category: 'drawing_donation',
      eventType: 'drawing_donation_moderation_block',
      provider: 'admin',
      channelUid: item.channelUid,
      viewerUserId: item.viewerUserId,
      viewerName: item.viewerName,
      pointDelta: refundedAmount,
      targetName: '그림 후원',
      summary: refundedAmount > 0 ? `그림 후원 차단 처리 및 ${refundedAmount}P 반환` : '그림 후원 차단 처리',
      status: refundedAmount > 0 ? 'refunded' : 'cancelled',
      metadata: { drawingId: item.id, reason },
    });
    notifyDrawingSubscribers(sid, 'moderated_block').catch(() => null);
    notifyDrawingAdminSubscribers(sid, 'moderated_block').catch(() => null);
    return res.json({ ok: true, item, refundedAmount });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to moderate drawing donation' });
  }
});

app.post('/api/drawing-donation/reorder', rateLimiters.userWrite, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const ids = Array.from(new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    const items = await reorderDrawingItemsForSid(sid, ids);
    notifyDrawingSubscribers(sid, 'reordered').catch(() => null);
    notifyDrawingAdminSubscribers(sid, 'reordered').catch(() => null);
    return res.json({ ok: true, items });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to reorder drawing donation queue' });
  }
});

app.get('/api/drawing-donation/viewer-url', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const settings = await getBotSettings(sid) || {};
    let token = String(settings.drawingDonationViewerToken || '').trim();
    if (!token) {
      token = drawingTokenFromSid(sid);
      await setBotSettings(sid, { ...settings, drawingDonationViewerToken: token });
    }
    drawingTokenToSid.set(token, sid);
    return res.json({ token, path: `/drawing-overlay/${encodeURIComponent(token)}` });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to get drawing overlay URL' });
  }
});

app.get('/api/drawing-donation/live-playback', rateLimiters.externalLookup, async (req, res) => {
  try {
    const provider = String(req.query?.provider || '').trim().toLowerCase();
    const channelId = String(req.query?.channelId || '').trim();
    if (!['chzzk', 'cime'].includes(provider) || !channelId) return res.status(400).json({ error: 'invalid_live_surface' });
    const playback = await resolveDrawingLivePlaybackUrl(provider, channelId);
    if (!playback?.playbackUrl) return res.status(404).json({ error: 'live_playback_not_found' });
    return res.json(playback);
  } catch (e) {
    console.warn('[Drawing Donation] live playback resolve failed:', e?.message || e);
    return res.status(502).json({ error: 'Failed to resolve live playback' });
  }
});

app.post('/api/drawing-donation/rotate-viewer-token', rateLimiters.userWrite, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const settings = await getBotSettings(sid) || {};
    const oldToken = String(settings.drawingDonationViewerToken || '').trim();
    const token = `draw_${pvdRandomToken(24)}`;
    await setBotSettings(sid, { ...settings, drawingDonationViewerToken: token });
    if (oldToken) drawingTokenToSid.delete(oldToken);
    drawingTokenToSid.set(token, sid);
    const sockets = drawingOverlaySockets.get(sid);
    if (sockets?.size) {
      for (const ws of Array.from(sockets)) {
        try { ws.close(4001, 'token_rotated'); } catch {}
      }
      drawingOverlaySockets.delete(sid);
    }
    notifyDrawingAdminSubscribers(sid, 'token_rotated').catch(() => null);
    return res.json({ ok: true, token, path: `/drawing-overlay/${encodeURIComponent(token)}` });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to rotate drawing overlay URL' });
  }
});

app.get('/api/drawing-donation/current', async (req, res) => {
  try {
    const token = String(req.query?.token || '').trim();
    const sid = await getDrawingSidByToken(token);
    if (!sid) return res.status(404).json({ error: 'token_not_found' });
    const item = await getCurrentDrawingItemForSid(sid);
    return res.json({ item, serverNow: Date.now() });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load current drawing donation' });
  }
});

app.post('/api/drawing-donation/pop-by-token', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const sid = await getDrawingSidByToken(token);
    if (!sid) return res.status(404).json({ error: 'token_not_found' });
    const current = await getCurrentDrawingItemForSid(sid);
    if (!current) return res.json({ item: null });
    const item = await updateDrawingItemStatusForSid(sid, current.id, 'done') || current;
    await recordBotEventLogSafe(sid, {
      category: 'drawing_donation',
      eventType: 'drawing_donation_done',
      provider: 'overlay',
      channelUid: item.channelUid,
      viewerUserId: item.viewerUserId,
      viewerName: item.viewerName,
      pointDelta: 0,
      targetName: '그림 후원',
      summary: '그림 후원 오버레이 재생 완료',
      status: 'success',
      metadata: { drawingId: item.id },
    });
    notifyDrawingSubscribers(sid, 'done').catch(() => null);
    notifyDrawingAdminSubscribers(sid, 'done').catch(() => null);
    return res.json({ item });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to pop drawing donation' });
  }
});

app.get('/api/viewer/drawing-donation/streamers', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const data = await collectViewerDrawingDonationStreamers(ownerUserId);
    return res.json(data);
  } catch (e) {
    console.error('[Drawing Donation] Failed to load viewer streamers:', e?.message || e);
    return res.status(500).json({ error: 'Failed to load drawing donation streamers' });
  }
});

app.get('/api/viewer/drawing-donation/streamers/:channelUid', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const channelUid = decodeURIComponent(String(req.params.channelUid || '')).trim();
    const data = await collectViewerDrawingDonationStreamers(ownerUserId);
    const streamer = data.streamers.find((item) => item.channelUid === channelUid || item.canonicalChannelUid === channelUid);
    if (!streamer) return res.status(404).json({ error: 'not_available' });
    return res.json({ ...data, streamer });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load drawing donation streamer' });
  }
});

app.post('/api/drawing-donation/submit', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const channelUid = String(req.body?.channelUid || '').trim();
    if (!channelUid) return res.status(400).json({ error: 'channelUid required' });
    const data = await collectViewerDrawingDonationStreamers(ownerUserId);
    const streamer = data.streamers.find((item) => item.channelUid === channelUid || item.canonicalChannelUid === channelUid);
    if (!streamer) return res.status(404).json({ error: 'not_available' });
    const resolved = await resolveDrawingDonationSettingsForBalance(streamer);
    if (!resolved?.drawing?.enabled) return res.status(400).json({ error: 'drawing_donation_disabled' });
    const blocked = findBlockedBotUser(resolved.settings, ownerUserId, null, data.identityKeys);
    if (blocked) return res.status(403).json({ error: 'blocked_user', message: '이 방송에서는 봇 기능을 사용할 수 없습니다.', block: blocked });

    const activeQueue = await listDrawingQueueForSid(resolved.sid).catch(() => []);
    const viewerActiveItems = (activeQueue || []).filter((item) => String(item.viewerUserId || '') === ownerUserId);
    if (resolved.drawing.perUserQueueLimit > 0 && viewerActiveItems.length >= resolved.drawing.perUserQueueLimit) {
      return res.status(429).json({ error: 'drawing_queue_limit', limit: resolved.drawing.perUserQueueLimit });
    }
    const cooldownMs = Math.max(0, Number(resolved.drawing.submitCooldownSec || 0) * 1000);
    if (cooldownMs > 0) {
      const lastSubmittedAt = viewerActiveItems
        .map((item) => new Date(item.createdAt || 0).getTime())
        .filter((time) => Number.isFinite(time) && time > 0)
        .sort((a, b) => b - a)[0] || 0;
      const remainingMs = cooldownMs - (Date.now() - lastSubmittedAt);
      if (remainingMs > 0) {
        return res.status(429).json({ error: 'drawing_submit_cooldown', retryAfterSec: Math.ceil(remainingMs / 1000) });
      }
    }

    const { strokes, pointCount, rawPointCount, jsonSize, ink } = normalizeDrawingStrokePayload(req.body || {}, resolved.drawing);
    const cost = calculateDrawingDonationCost(resolved.drawing, ink);
    if (Number(streamer.points || 0) < cost) return res.status(400).json({ error: 'insufficient_points', need: cost, have: Number(streamer.points || 0) });
    const payment = applyDrawingPointCost(streamer, cost);
    if (!payment.ok) return res.status(400).json({ error: 'insufficient_points', need: cost, have: Number(streamer.points || 0) });

    const replay = computeDrawingReplay(strokes, resolved.drawing.replayMaxSec);
    for (const deduction of payment.deductions) {
      await incrChannelPoints(streamer.channelUid, deduction.userId, deduction.username || null, -Number(deduction.amount || 0));
    }

    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      ownerSid: resolved.sid,
      channelUid: streamer.channelUid,
      viewerUserId: ownerUserId,
      viewerName: req.body?.viewerName ? String(req.body.viewerName) : null,
      status: resolved.drawing.approvalMode === 'auto' ? 'approved' : 'queued',
      cost,
      pointDeductions: payment.deductions,
      pointRefunded: false,
      canvas: resolved.drawing.canvas,
      strokes,
      previewImage: normalizeDrawingPreviewImage(req.body?.previewImage),
      metrics: { strokeCount: strokes.length, pointCount, rawPointCount, jsonSize, ink },
      replay,
      resultHoldSec: resolved.drawing.resultHoldSec,
      createdAt: new Date().toISOString(),
      approvedAt: resolved.drawing.approvalMode === 'auto' ? new Date().toISOString() : null,
    };
    const strokeObjectKey = await maybeStoreDrawingStrokes(resolved.sid, item.id, strokes);
    if (strokeObjectKey) {
      item.strokeObjectKey = strokeObjectKey;
      item.strokes = [];
      item.metrics = { ...item.metrics, storage: { strokeObjectKey, strokeStorage: 'supabase' } };
    }
    let savedItem = item;
    try {
      savedItem = await insertDrawingDonationItem(item);
    } catch (error) {
      console.warn('[Drawing Donation] DB insert failed; using memory fallback:', error?.message || error);
      getDrawingQueue(resolved.sid).push(item);
    }
    notifyDrawingSubscribers(resolved.sid, item.status === 'approved' ? 'auto_approved' : 'queued').catch(() => null);
    notifyDrawingAdminSubscribers(resolved.sid, 'submitted').catch(() => null);
    await recordBotEventLogSafe(resolved.sid, {
      category: 'drawing_donation',
      eventType: 'drawing_donation_request',
      provider: 'viewer',
      channelUid: streamer.channelUid,
      viewerUserId: ownerUserId,
      viewerName: item.viewerName,
      pointDelta: -cost,
      targetName: '그림 후원',
      summary: `그림 후원 신청 (${cost}P 사용)`,
      metadata: { drawingId: item.id, strokeCount: strokes.length, pointCount, ink },
    });
    return res.json({ ok: true, item: savedItem });
  } catch (e) {
    const status = e?.status || 500;
    console.error('[Drawing Donation] submit failed:', e?.message || e);
    return res.status(status).json({ error: e?.message || 'Failed to submit drawing donation' });
  }
});

// Public: resolve roulette viewer token from channel UID
app.get('/api/roulette/resolve-token', async (req, res) => {
  try {
    const uid = String(req.query.uid || '').trim();
    if (!uid) return res.status(400).json({ error: 'uid required' });
    const sid = `user:${uid}`;
    const settings = await getBotSettings(sid) || {};
    let token = await getOrCreateViewerTokenSupabase(uid, 'roulette', sid, 'rlt').catch(() => null);
    if (!token) {
      token = typeof settings.rouletteViewerToken === 'string' && settings.rouletteViewerToken.trim()
        ? String(settings.rouletteViewerToken).trim()
        : '';
    }
    if (!token) {
      token = 'rlt_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
      try { await setBotSettings(sid, { ...settings, rouletteViewerToken: token }); } catch { }
    } else if (settings.rouletteViewerToken !== token) {
      try { await setBotSettings(sid, { ...settings, rouletteViewerToken: token }); } catch { }
    }
    try { rouletteTokenToSid.set(token, sid); } catch { }
    return res.json({ token, path: `/roulette/${encodeURIComponent(token)}` });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to resolve token' });
  }
});

// Public: list roulette logs by channel UID (no auth)
// GET /api/roulette/logs?uid=<channelUid>&q=&limit=&offset=
app.get('/api/roulette/logs', async (req, res) => {
  try {
    const uid = String(req.query.uid || '').trim();
    if (!uid) return res.status(400).json({ error: 'uid required' });
    const sid = `user:${uid}`;
    const settings = await getBotSettings(sid) || {};
    const token = settings.rouletteViewerToken;
    if (!token) return res.status(404).json({ error: 'not_found' });
    const q = req.query?.q ? String(req.query.q) : '';
    const limit = req.query?.limit ? Math.max(1, Math.min(200, parseInt(String(req.query.limit)))) : 50;
    const offset = req.query?.offset ? Math.max(0, parseInt(String(req.query.offset))) : 0;
    const rows = await listRouletteSessionsByToken(token, { q, limit, offset });
    return res.json({ items: rows, limit, offset });
  } catch (e) {
    return res.status(500).json({ error: 'failed' });
  }
});

function getPathValue(source, pathExpression) {
  const path = String(pathExpression || '').replace(/^\{|\}$/g, '').trim();
  if (!path) return undefined;
  return path.split('.').reduce((value, key) => {
    if (value == null) return undefined;
    return value[key];
  }, source);
}

function buildBlueprintScope(context = {}, flow = {}, nodeOutputs = {}) {
  return {
    ...(context || {}),
    flow,
    node: nodeOutputs,
    user: context.user || {},
    channel: context.channel || {},
    trigger: context.trigger || {},
    roulette: context.roulette || {},
    donation: context.donation || {},
    attendance: context.attendance || {},
    live: context.live || {}
  };
}

function renderBlueprintTemplate(value, scope = {}) {
  if (value == null) return '';
  return String(value).replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, pathExpression) => {
    const resolved = getPathValue(scope, pathExpression);
    if (resolved == null) return '';
    if (typeof resolved === 'object') return JSON.stringify(resolved);
    return String(resolved);
  });
}

function renderBlueprintValueDeep(value, scope = {}) {
  if (typeof value === 'string') return renderBlueprintTemplate(value, scope);
  if (Array.isArray(value)) return value.map((item) => renderBlueprintValueDeep(item, scope));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderBlueprintValueDeep(item, scope)]));
  }
  return value;
}

function evaluateBlueprintValue(value, scope = {}) {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value == null) return '';
  const rendered = renderBlueprintTemplate(value, scope).trim();
  if (/^(true|false)$/i.test(rendered)) return rendered.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(rendered)) return Number(rendered);
  if (/^[\d\s+\-*/().%]+$/.test(rendered) && /[+\-*/%]/.test(rendered)) {
    try {
      // Safe after strict whitelist: numbers, spaces, and arithmetic operators only.
      const result = Function(`"use strict"; return (${rendered});`)();
      return Number.isFinite(Number(result)) ? Number(result) : rendered;
    } catch { }
  }
  return rendered;
}

function compareBlueprintValues(left, operator, right) {
  const op = String(operator || 'eq');
  if (op === 'exists') return left != null && left !== '';
  if (op === 'empty') return left == null || left === '';
  if (op === 'contains') return String(left ?? '').includes(String(right ?? ''));
  if (op === 'regex') {
    try { return new RegExp(String(right || '')).test(String(left ?? '')); } catch { return false; }
  }
  const ln = Number(left);
  const rn = Number(right);
  const bothNumbers = Number.isFinite(ln) && Number.isFinite(rn);
  if (op === 'gt') return bothNumbers ? ln > rn : String(left) > String(right);
  if (op === 'gte') return bothNumbers ? ln >= rn : String(left) >= String(right);
  if (op === 'lt') return bothNumbers ? ln < rn : String(left) < String(right);
  if (op === 'lte') return bothNumbers ? ln <= rn : String(left) <= String(right);
  if (op === 'neq') return String(left) !== String(right);
  return String(left) === String(right);
}

function blueprintInputPorts(node = {}) {
  return node.type === 'start' ? [] : ['in'];
}

function blueprintOutputPorts(node = {}) {
  const type = String(node?.type || '');
  if (type === 'end') return [];
  if (['condition', 'pointsEnough', 'pointsExcluded', 'rouletteCompare', 'cooldown', 'loop'].includes(type)) return ['true', 'false'];
  if (type === 'random') {
    const options = Array.isArray(node?.config?.options) ? node.config.options : [];
    return options.length ? options.map((option, index) => `option:${option?.id || index}`) : ['option:a', 'option:b'];
  }
  return ['out'];
}

function blueprintAllowsMultipleOutgoing(node = {}) {
  return String(node?.type || '') === 'parallel';
}

const OBS_SCENE_ACTIONS = new Set(['scene.switch', 'scene.preview']);
const OBS_SCENE_SOURCE_ACTIONS = new Set(['source.show', 'source.hide', 'source.toggle', 'source.visibility']);
const OBS_FILTER_ACTIONS = new Set(['filter.on', 'filter.off', 'filter.toggle', 'filter.enabled']);
const OBS_INPUT_ACTIONS = new Set(['input.mute', 'input.unmute', 'input.toggleMute', 'input.volume', 'input.text', 'input.settings']);
const OBS_MEDIA_ACTIONS = new Set(['media.play', 'media.pause', 'media.stop', 'media.restart', 'media.next', 'media.previous']);
const OBS_SUPPORTED_ACTIONS = new Set([
  ...OBS_SCENE_ACTIONS,
  ...OBS_SCENE_SOURCE_ACTIONS,
  ...OBS_FILTER_ACTIONS,
  ...OBS_INPUT_ACTIONS,
  ...OBS_MEDIA_ACTIONS,
  'record.start', 'record.stop', 'record.toggle', 'record.pause', 'record.resume', 'record.togglePause', 'record.split', 'record.chapter',
  'stream.start', 'stream.stop', 'stream.toggle', 'stream.caption',
  'replay.start', 'replay.stop', 'replay.toggle', 'replay.save',
  'virtualcam.start', 'virtualcam.stop', 'virtualcam.toggle',
  'transition.set', 'transition.duration',
  'studio.mode.on', 'studio.mode.off', 'studio.mode.toggle',
  'hotkey.trigger',
]);

function isBlankConfigValue(value) {
  return value == null || String(value).trim() === '';
}

function validateBlueprintNodeConfig(node = {}) {
  const errors = [];
  const config = node.config || {};
  const label = node.name || node.type || '노드';
  const need = (key, field) => {
    if (isBlankConfigValue(config[key])) errors.push(`${label}: ${field} 값이 필요합니다.`);
  };
  const numberInRange = (key, field, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => {
    if (isBlankConfigValue(config[key])) return;
    const value = Number(config[key]);
    if (!Number.isFinite(value) || value < min || value > max) errors.push(`${label}: ${field} 값이 올바른 숫자여야 합니다.`);
  };
  if (node.type === 'chat') need('message', '메시지');
  if (node.type === 'readVariable') need('path', '읽을 변수');
  if (node.type === 'condition' || node.type === 'rouletteCompare') {
    need('left', '좌변');
    need('operator', '연산자');
    if (!['exists', 'empty'].includes(String(config.operator || 'eq'))) need('right', '우변');
  }
  if (node.type === 'setVariable') need('key', '변수 이름');
  if (node.type === 'random') {
    const options = Array.isArray(config.options) ? config.options : [];
    if (options.length < 2) errors.push(`${label}: 랜덤 분기는 선택지가 2개 이상 필요합니다.`);
    const ids = options.map((option, index) => String(option?.id || index).trim());
    if (new Set(ids).size !== ids.length) errors.push(`${label}: 분기 포트 ID가 중복되었습니다.`);
    if (!options.some((option) => Number(option?.weight ?? 1) > 0)) errors.push(`${label}: 가중치가 1 이상인 선택지가 필요합니다.`);
  }
  if (node.type === 'action') need('actionId', '실행할 액션 ID');
  if (node.type === 'wait') numberInRange('seconds', '대기 시간', 0);
  if (node.type === 'loop') {
    numberInRange('count', '반복 횟수', 0);
    numberInRange('gapMs', '반복 간격', 0);
  }
  if (node.type === 'pointsAdjust') {
    need('delta', '변경 포인트');
    numberInRange('delta', '변경 포인트');
  }
  if (node.type === 'pointsEnough') need('required', '필요 포인트');
  if (node.type === 'pointsRanking') numberInRange('limit', '조회 인원', 1, 50);
  if (node.type === 'rouletteRun') need('name', '룰렛 이름 또는 ID');
  if (node.type === 'rouletteDisplay' || node.type === 'overlay') need('text', '표시 내용');
  if (node.type === 'overlayUpdate' || node.type === 'overlayHide') need('overlayId', '오버레이 ID');
  if (node.type === 'fx') {
    const kind = String(config.kind || 'image');
    if (kind !== 'video' || !String(config.youtubeUrl || '').trim()) need('assetId', 'FX 에셋');
  }
  if (node.type === 'tts') need('text', '말할 내용');
  if (node.type === 'http') need('url', 'URL');
  if (node.type === 'http') {
    const method = String(config.method || 'POST').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      errors.push(`${label}: HTTP 메서드는 GET, POST, PUT, PATCH, DELETE 중 하나여야 합니다.`);
    }
    if (!isBlankConfigValue(config.headers)) {
      try {
        const parsed = typeof config.headers === 'object' ? config.headers : JSON.parse(String(config.headers));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          errors.push(`${label}: Headers는 JSON 객체여야 합니다.`);
        }
      } catch {
        errors.push(`${label}: Headers JSON 형식이 올바르지 않습니다.`);
      }
    }
  }
  if (node.type === 'websocket') {
    need('url', 'URL');
    need('message', '메시지');
  }
  if (node.type === 'udp') {
    need('host', '호스트');
    need('port', '포트');
    numberInRange('port', '포트', 1, 65535);
    need('message', '메시지');
  }
  if (node.type === 'tits') need('triggerId', '트리거');
  if (node.type === 'vtube' && isBlankConfigValue(config.hotkeyId) && isBlankConfigValue(config.parameter)) {
    errors.push(`${label}: 핫키 또는 파라미터 중 하나가 필요합니다.`);
  }
  if (node.type === 'obs') {
    const action = String(config.action || 'scene.switch');
    if (!OBS_SUPPORTED_ACTIONS.has(action)) errors.push(`${label}: 지원하지 않는 OBS 동작입니다.`);
    if (OBS_SCENE_ACTIONS.has(action)) need('sceneName', '장면 이름');
    if (OBS_SCENE_SOURCE_ACTIONS.has(action)) {
      need('sceneName', '장면 이름');
      need('sourceName', '소스 이름');
    }
    if (OBS_FILTER_ACTIONS.has(action)) {
      need('sourceName', '소스 이름');
      need('filterName', '필터 이름');
    }
    if (OBS_INPUT_ACTIONS.has(action) || OBS_MEDIA_ACTIONS.has(action)) need('sourceName', '소스/입력 이름');
    if (action === 'input.volume') numberInRange('volume', '볼륨', 0, 2);
    if (action === 'input.text' || action === 'stream.caption') need('text', '텍스트');
    if (action === 'input.settings' && !isBlankConfigValue(config.inputSettingsJson)) {
      try {
        const parsed = typeof config.inputSettingsJson === 'object' ? config.inputSettingsJson : JSON.parse(String(config.inputSettingsJson));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) errors.push(`${label}: 입력 설정 JSON은 객체여야 합니다.`);
      } catch {
        errors.push(`${label}: 입력 설정 JSON 형식이 올바르지 않습니다.`);
      }
    }
    if (action === 'hotkey.trigger') need('hotkeyName', '핫키');
    if (action === 'transition.set') need('transitionName', '전환 효과');
    if (action === 'transition.duration') numberInRange('durationMs', '전환 시간', 0);
  }
  if (node.type === 'approval') need('message', '승인 메시지');
  return errors;
}

function hasBlueprintCycle(nodes = [], edges = []) {
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  const graph = new Map([...nodeIds].map((id) => [id, []]));
  for (const edge of edges) {
    const source = String(edge.source);
    const target = String(edge.target);
    if (nodeIds.has(source) && nodeIds.has(target)) graph.get(source).push(target);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (nodeId) => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const next of graph.get(nodeId) || []) {
      if (visit(next)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  return [...nodeIds].some((nodeId) => visit(nodeId));
}

function validateBlueprintGraph(nodes = [], edges = []) {
  const errors = [];
  const startNodes = nodes.filter((node) => node.type === 'start');
  if (startNodes.length !== 1) errors.push('시작 노드는 반드시 1개여야 합니다.');
  const seenNodeIds = new Set();
  for (const node of nodes) {
    const nodeId = String(node.id || '');
    if (!nodeId) errors.push('ID가 없는 노드가 있습니다.');
    if (seenNodeIds.has(nodeId)) errors.push(`중복된 노드 ID가 있습니다: ${nodeId}`);
    seenNodeIds.add(nodeId);
    if (node.type === 'start' && blueprintInputPorts(node).length) errors.push('시작 노드에는 입력 포트가 없어야 합니다.');
    if (node.type === 'end' && blueprintOutputPorts(node).length) errors.push('종료 노드에는 출력 포트가 없어야 합니다.');
    errors.push(...validateBlueprintNodeConfig(node));
  }
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  const nodeById = new Map(nodes.map((node) => [String(node.id), node]));
  const outputUse = new Set();
  for (const edge of edges) {
    const sourceNode = nodeById.get(String(edge.source));
    const targetNode = nodeById.get(String(edge.target));
    if (!sourceNode || !targetNode) {
      errors.push('존재하지 않는 노드를 연결한 선이 있습니다.');
      continue;
    }
    if (!blueprintOutputPorts(sourceNode).includes(String(edge.sourcePort || 'out'))) {
      errors.push(`${sourceNode.name || sourceNode.type}: 존재하지 않는 출력 포트가 연결되어 있습니다.`);
    }
    if (!blueprintInputPorts(targetNode).includes(String(edge.targetPort || 'in'))) {
      errors.push(`${targetNode.name || targetNode.type}: 존재하지 않는 입력 포트가 연결되어 있습니다.`);
    }
    const outputKey = `${edge.source}:${edge.sourcePort || 'out'}`;
    if (!blueprintAllowsMultipleOutgoing(sourceNode)) {
      if (outputUse.has(outputKey)) errors.push('하나의 출력 포트에서 여러 연결이 나갈 수 없습니다. 동시에 여러 노드를 실행하려면 다중 실행 노드를 사용하세요.');
      outputUse.add(outputKey);
    }
  }
  if (nodeIds.size && hasBlueprintCycle(nodes, edges)) errors.push('순환 연결은 실행할 수 없습니다. 반복은 N회 반복 노드를 사용하세요.');
  return Array.from(new Set(errors));
}

async function resolveBlueprintChannelUid(ownerUserId, context = {}) {
  const direct = context.channelUid || context.channel?.channelUid || context.channel?.id || context.roulette?.channelUid;
  if (direct) return String(direct);
  const sid = `user:${ownerUserId}`;
  const settings = await getBotSettings(sid).catch(() => null) || {};
  const uids = await resolveChzzkChannelUidsForSid(sid, settings);
  return uids[0] || ownerUserId;
}

async function executeBlueprintChatNode(ownerUserId, sid, node, text, context = {}) {
  const platform = String(context.platform || context.trigger?.platform || context.chatPost?.platform || '').toLowerCase();
  if (context.dryRun || context.source === 'manual_test') {
    return { sent: false, dryRun: true, platform: platform || 'simulator', text };
  }
  const chatPost = context.chatPost || null;
  if (chatPost && (!platform || platform === String(chatPost.platform || '').toLowerCase())) {
    await sendChatByPost(sid, chatPost, text, { timeout: 5000 });
    return { sent: true, platform: chatPost.platform || platform || 'trigger' };
  }
  if (platform === 'cime') {
    await sendCimeChat(ownerUserId, text);
    return { sent: true, platform: 'cime' };
  }
  const live = liveStatusCache.get(sid);
  if (!platform && !live?.live) return { sent: false, reason: 'not_live' };
  return { sent: false, reason: 'chat_session_unavailable' };
}

async function executeActionBlueprint(ownerUserId, idOrSlug, context = {}) {
  const blueprint = await getActionBlueprint(ownerUserId, idOrSlug);
  if (!blueprint || blueprint.enabled === false) return { ok: false, error: 'blueprint_not_found' };
  const dryRun = context.dryRun === true || context.source === 'manual_test';
  const suppressPointMutations = context.replayNoCost === true || context.noPointCost === true;
  const version = blueprint.version || {};
  if (!version.published && context.source !== 'manual_test') return { ok: false, error: 'blueprint_not_published' };
  const nodes = Array.isArray(version.nodes) ? version.nodes : [];
  const edges = Array.isArray(version.edges) ? version.edges : [];
  const validationErrors = validateBlueprintGraph(nodes, edges);
  if (validationErrors.length) return { ok: false, error: 'blueprint_invalid', validationErrors };

  const sid = `user:${ownerUserId}`;
  const run = await insertActionBlueprintRun(ownerUserId, {
    blueprintId: blueprint.id,
    versionId: version.id,
    triggerSource: context.source || 'manual',
    triggerRef: context.triggerRef || idOrSlug,
    context,
    status: 'running'
  });
  const nodeMap = new Map(nodes.map((node) => [String(node.id), node]));
  const edgeFrom = (nodeId, port = 'out') => edges.find((edge) => String(edge.source) === String(nodeId) && String(edge.sourcePort || 'out') === String(port));
  const flow = {};
  const nodeOutputs = {};
  const executed = [];

  async function recordStep(node, status, input, output, startedAt, error = null) {
    const durationMs = Date.now() - startedAt;
    await insertActionBlueprintRunStep(ownerUserId, {
      runId: run.id,
      nodeId: node.id,
      nodeType: node.type,
      status,
      input,
      output,
      durationMs,
      error
    }).catch(() => null);
  }

  async function runNode(nodeId, incoming = {}, depth = 0) {
    const node = nodeMap.get(String(nodeId));
    if (!node || node.enabled === false) return null;
    const startedAt = Date.now();
    const config = node.config || {};
    const scope = buildBlueprintScope(context, flow, nodeOutputs);
    let output = {};
    let nextPort = 'out';
    executed.push(node.id);
    try {
      if (node.type === 'start') {
        output = { context };
      } else if (node.type === 'end') {
        output = { status: config.status || 'success', message: renderBlueprintTemplate(config.message || '', scope) };
        await recordStep(node, 'done', incoming, output, startedAt);
        return output;
      } else if (node.type === 'chat') {
        const message = renderBlueprintTemplate(config.message || config.text || '', scope).slice(0, 100);
        output = await executeBlueprintChatNode(ownerUserId, sid, node, message, context);
      } else if (node.type === 'wait') {
        const delayMs = Math.max(0, Number(evaluateBlueprintValue(config.ms || Number(config.seconds || 0) * 1000, scope) || 0));
        if (!dryRun && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        output = { waitedMs: delayMs, dryRun };
      } else if (node.type === 'condition') {
        const left = evaluateBlueprintValue(config.left, scope);
        const right = evaluateBlueprintValue(config.right, scope);
        const passed = compareBlueprintValues(left, config.operator, right);
        output = { passed, left, right };
        nextPort = passed ? 'true' : 'false';
      } else if (node.type === 'setVariable') {
        const key = String(config.key || '').replace(/^flow\./, '').trim();
        if (key) {
          const previous = flow[key];
          const value = evaluateBlueprintValue(config.value, scope);
          const mode = String(config.mode || 'set');
          if (mode === 'add') flow[key] = Number(previous || 0) + Number(value || 0);
          else if (mode === 'subtract') flow[key] = Number(previous || 0) - Number(value || 0);
          else if (mode === 'multiply') flow[key] = Number(previous || 0) * Number(value || 0);
          else if (mode === 'divide') flow[key] = Number(value || 0) ? Number(previous || 0) / Number(value || 1) : previous;
          else if (mode === 'append') flow[key] = `${previous || ''}${value}`;
          else flow[key] = value;
          output = { key, value: flow[key] };
        }
      } else if (node.type === 'readVariable') {
        const value = evaluateBlueprintValue(config.path || config.value, scope);
        output = { value };
      } else if (node.type === 'action') {
        const actionId = renderBlueprintTemplate(config.actionId || '', scope);
        const actionStack = Array.isArray(context.actionStack) ? context.actionStack.map(String) : [];
        const normalizedActionId = String(actionId || '');
        const currentActionKeys = [blueprint.id, blueprint.slug].map(String).filter(Boolean);
        output = normalizedActionId && !currentActionKeys.includes(normalizedActionId) && !actionStack.includes(normalizedActionId)
          ? await executeActionBlueprint(ownerUserId, normalizedActionId, { ...context, source: dryRun ? 'manual_test' : 'blueprint_nested', dryRun, actionStack: [...actionStack, ...currentActionKeys] })
          : { ok: false, error: 'recursive_action_blocked' };
      } else if (node.type === 'parallel') {
        const outgoing = edges.filter((edge) => String(edge.source) === String(node.id) && String(edge.sourcePort || 'out') === 'out');
        output = { count: outgoing.length, results: [], completed: false };
        nodeOutputs[node.id] = output;
        nodeOutputs[node.type] = output;
        const results = await Promise.all(outgoing.map((edge) => runNode(edge.target, output, depth + 1)));
        output.results = results;
        output.completed = true;
        await recordStep(node, 'done', incoming, output, startedAt);
        return output;
      } else if (node.type === 'loop') {
        const count = Math.max(0, Math.floor(Number(evaluateBlueprintValue(config.count || 1, scope) || 0)));
        const gapMs = Math.max(0, Math.floor(Number(evaluateBlueprintValue(config.gapMs || 0, scope) || 0)));
        const trueEdge = edgeFrom(node.id, 'true');
        for (let index = 0; index < count; index += 1) {
          flow.loop = { index: index + 1, total: count };
          if (trueEdge) await runNode(trueEdge.target, { loop: flow.loop }, depth + 1);
          if (gapMs && !dryRun) await new Promise((resolve) => setTimeout(resolve, gapMs));
        }
        output = { count };
        nextPort = 'false';
      } else if (node.type === 'random') {
        const options = Array.isArray(config.options) ? config.options : [];
        const weighted = options.map((option, index) => ({ ...option, index, weight: Math.max(0, Number(evaluateBlueprintValue(option.weight ?? 1, scope) || 0)) })).filter((option) => option.weight > 0);
        const total = weighted.reduce((sum, option) => sum + option.weight, 0);
        let cursor = Math.random() * Math.max(1, total);
        const picked = weighted.find((option) => (cursor -= option.weight) <= 0) || weighted[0] || { id: 'out', label: '기본', index: 0 };
        output = { picked };
        nextPort = `option:${picked.id || picked.index}`;
      } else if (node.type === 'pointsGet' || node.type === 'pointsEnough' || node.type === 'pointsAdjust') {
        const channelUid = await resolveBlueprintChannelUid(ownerUserId, context);
        const userId = renderBlueprintTemplate(config.userId || '{user.userId}', scope) || context.user?.userId;
        const username = renderBlueprintTemplate(config.username || '{user.username}', scope) || context.user?.username;
        const simulatedUser = userId && String(userId) === String(context.user?.userId || '');
        const current = dryRun && simulatedUser
          ? Number(context.user?.points || context.user?.channelPoints || 0)
          : userId ? await getChannelPoints(channelUid, userId).catch(() => 0) : 0;
        if (node.type === 'pointsAdjust' && userId) {
          const delta = Math.floor(Number(evaluateBlueprintValue(config.delta || 0, scope) || 0));
          if (!dryRun && !suppressPointMutations) await incrChannelPoints(channelUid, userId, username || userId, delta);
          output = { channelUid, userId, previous: current, delta, points: suppressPointMutations ? current : current + delta, dryRun, noPointCost: suppressPointMutations };
        } else if (node.type === 'pointsEnough') {
          const required = Math.max(0, Number(evaluateBlueprintValue(config.required || 0, scope) || 0));
          const passed = Number(current || 0) >= required;
          output = { channelUid, userId, points: current, required, passed };
          nextPort = passed ? 'true' : 'false';
        } else {
          output = { channelUid, userId, points: current };
        }
      } else if (node.type === 'pointsRanking') {
        const channelUid = await resolveBlueprintChannelUid(ownerUserId, context);
        const limit = Math.max(1, Math.min(50, Number(evaluateBlueprintValue(config.limit || 10, scope) || 10)));
        const page = await listChannelPointsPage(channelUid, { offset: 0, limit }).catch(() => ({ rows: [] }));
        output = { channelUid, ranking: page.rows || [] };
      } else if (node.type === 'pointsExcluded') {
        const channelUid = await resolveBlueprintChannelUid(ownerUserId, context);
        const settings = await getBotSettings(sid).catch(() => null) || {};
        const userId = renderBlueprintTemplate(config.userId || '{user.userId}', scope) || context.user?.userId;
        const excluded = !!(userId && await isChannelPointExcluded(settings, userId));
        output = { channelUid, userId, excluded };
        nextPort = excluded ? 'true' : 'false';
      } else if (node.type === 'rouletteRun') {
        const settings = await getBotSettings(sid).catch(() => null) || {};
        const defs = getRouletteDefsFromSettings(settings);
        const name = renderBlueprintTemplate(config.name || '', scope);
        const def = defs.find((item) => String(item.id || item.name) === name || String(item.name) === name);
        const picked = def ? chooseRouletteItem(def) : null;
        output = { roulette: def ? { id: def.id || null, name: def.name } : null, result: picked };
      } else if (node.type === 'rouletteList') {
        const settings = await getBotSettings(sid).catch(() => null) || {};
        const defs = getRouletteDefsFromSettings(settings);
        output = { roulettes: defs.map((item) => ({ id: item.id || item.name, name: item.name, items: Array.isArray(item.items) ? item.items.length : 0 })) };
      } else if (node.type === 'rouletteCompare') {
        const left = evaluateBlueprintValue(config.left || '{roulette.result.label}', scope);
        const right = evaluateBlueprintValue(config.right || '', scope);
        const passed = compareBlueprintValues(left, config.operator || 'eq', right);
        output = { passed, left, right };
        nextPort = passed ? 'true' : 'false';
      } else if (node.type === 'attendanceGet') {
        const userId = renderBlueprintTemplate(config.userId || '{user.userId}', scope) || context.user?.userId;
        const totalDays = userId ? await getUserAttendanceTotalDays(sid, userId).catch(() => 0) : 0;
        output = { userId, totalDays };
      } else if (node.type === 'cooldown') {
        const key = `${blueprint.id}:${node.id}:${renderBlueprintTemplate(config.key || '{user.userId}', scope)}`;
        const seconds = Math.max(0, Number(evaluateBlueprintValue(config.seconds || 30, scope) || 30));
        const now = Date.now();
        globalThis.__arubotBlueprintCooldowns ||= new Map();
        const until = globalThis.__arubotBlueprintCooldowns.get(key) || 0;
        const passed = dryRun ? true : now >= until;
        if (passed && !dryRun) globalThis.__arubotBlueprintCooldowns.set(key, now + seconds * 1000);
        output = { key, passed, remainingMs: passed ? 0 : until - now, dryRun };
        nextPort = passed ? 'true' : 'false';
      } else if (node.type === 'highlight') {
        output = { marked: true, label: renderBlueprintTemplate(config.label || '하이라이트', scope), at: new Date().toISOString() };
      } else if (node.type === 'log') {
        output = { message: renderBlueprintTemplate(config.message || '', scope), at: new Date().toISOString() };
      } else if (node.type === 'join') {
        output = { joined: true, incoming };
      } else if (node.type === 'approval') {
        const message = renderBlueprintTemplate(config.message || '승인이 필요합니다.', scope);
        const job = dryRun ? null : await queueAutomationJob(ownerUserId, {
          connectionId: null,
          jobType: 'blueprint.approval',
          payload: { nodeId: node.id, blueprintId: blueprint.id, runId: run.id, message }
        });
        output = { queued: !dryRun, jobId: job?.id || null, approvalRequired: true, message, dryRun };
      } else if (node.type === 'timer') {
        const delayMs = Math.max(0, Number(evaluateBlueprintValue(config.delayMs || Number(config.seconds || 0) * 1000, scope) || 0));
        const edge = edgeFrom(node.id, 'out');
        if (edge && !dryRun) {
          await queueAutomationJob(ownerUserId, {
            connectionId: null,
            jobType: 'blueprint.timer',
            runAfter: new Date(Date.now() + delayMs).toISOString(),
            payload: { nodeId: node.id, blueprintId: blueprint.id, targetNodeId: edge.target, context }
          });
        }
        output = { queued: !dryRun && !!edge, delayMs, dryRun };
        await recordStep(node, 'done', incoming, output, startedAt);
        return output;
      } else if (node.type === 'fx' || node.type === 'sound') {
        const payload = normalizeFxPayload({
          ...(config || {}),
          kind: node.type === 'sound' ? 'sound' : config.kind,
          assetId: config.assetId || config.fileId,
          assetName: config.assetName || config.fileName
        });
        const job = dryRun ? null : await queueAutomationJob(ownerUserId, {
          connectionId: config.connectionId || null,
          jobType: 'fx.play',
          payload: { nodeId: node.id, blueprintId: blueprint.id, runId: run.id, ...payload }
        });
        output = { queued: !dryRun, jobId: job?.id || null, type: 'fx', payload, dryRun };
      } else if (node.type === 'overlay' || node.type === 'rouletteDisplay') {
        const overlayId = renderBlueprintTemplate(config.overlayId || `overlay_${node.id}_${Date.now().toString(36)}`, scope);
        const payload = normalizeFxPayload({
          ...renderBlueprintValueDeep(config || {}, scope),
          id: overlayId,
          overlayId,
          kind: 'text',
          text: renderBlueprintTemplate(config.text || '', scope),
          x: config.x ?? 50,
          y: config.y ?? 50,
          width: config.width ?? 46,
          height: config.height ?? 16,
        });
        const sent = dryRun ? 0 : broadcastFxToSid(sid, payload);
        output = { shown: sent > 0, overlayId, sent, payload, dryRun };
      } else if (node.type === 'overlayUpdate') {
        const overlayId = renderBlueprintTemplate(config.overlayId || '', scope);
        const payload = normalizeFxPayload({
          ...renderBlueprintValueDeep(config || {}, scope),
          id: overlayId,
          overlayId,
          kind: 'text',
          text: renderBlueprintTemplate(config.text || '', scope),
        });
        const sent = dryRun ? 0 : broadcastFxEventToSid(sid, 'fx:update', payload);
        output = { updated: sent > 0, overlayId, sent, payload, dryRun };
      } else if (node.type === 'overlayHide') {
        const overlayId = renderBlueprintTemplate(config.overlayId || '', scope);
        const sent = dryRun ? 0 : broadcastFxEventToSid(sid, 'fx:hide', { id: overlayId, overlayId, kind: 'text' });
        output = { hidden: sent > 0, overlayId, sent, dryRun };
      } else if (node.type === 'tts') {
        const payload = normalizeFxPayload({
          ...renderBlueprintValueDeep(config || {}, scope),
          kind: 'tts',
          text: renderBlueprintTemplate(config.text || '', scope),
          voice: renderBlueprintTemplate(config.voice || '', scope),
          rate: Math.min(2, Math.max(0.5, Number(evaluateBlueprintValue(config.rate || 1, scope) || 1))),
          pitch: Math.min(2, Math.max(0.5, Number(evaluateBlueprintValue(config.pitch || 1, scope) || 1))),
        });
        payload.voice = String(config.voice ? renderBlueprintTemplate(config.voice, scope) : '').slice(0, 120);
        payload.rate = Math.min(2, Math.max(0.5, Number(evaluateBlueprintValue(config.rate || 1, scope) || 1)));
        payload.pitch = Math.min(2, Math.max(0.5, Number(evaluateBlueprintValue(config.pitch || 1, scope) || 1)));
        const sent = dryRun ? 0 : broadcastFxToSid(sid, payload);
        const job = dryRun || sent > 0 ? null : await queueAutomationJob(ownerUserId, {
          jobType: 'tts.speak',
          payload: { text: payload.text, voice: payload.voice, rate: payload.rate, pitch: payload.pitch, nodeId: node.id, blueprintId: blueprint.id, runId: run.id }
        });
        output = { spoken: sent > 0, queued: !!job, jobId: job?.id || null, sent, voice: payload.voice || '', payload, dryRun };
      } else if (['obs', 'http', 'websocket', 'udp', 'tits', 'vtube', 'chatVote'].includes(node.type)) {
        const payload = renderBlueprintValueDeep(config || {}, scope);
        if (payload.connectionId && !payload.endpoint) {
          const connections = await listAutomationConnections(ownerUserId).catch(() => []);
          const connection = connections.find((item) => String(item.id || '') === String(payload.connectionId));
          if (connection?.endpoint) payload.endpoint = connection.endpoint;
        }
        const job = dryRun ? null : await queueAutomationJob(ownerUserId, {
          connectionId: config.connectionId || null,
          jobType: `blueprint.${node.type}`,
          payload: { nodeId: node.id, blueprintId: blueprint.id, runId: run.id, ...payload }
        });
        output = { queued: !dryRun, jobId: job?.id || null, type: node.type, payload, dryRun };
      } else {
        output = { skipped: true, type: node.type };
      }
      nodeOutputs[node.id] = output;
      nodeOutputs[node.type] = output;
      if (node.type === 'action') {
        const actionKey = renderBlueprintTemplate(config.actionId || '', scope);
        if (actionKey) {
          nodeOutputs.action ||= {};
          nodeOutputs.action[actionKey] = output;
        }
      }
      await recordStep(node, 'done', incoming, output, startedAt);
      if (node.type === 'loop') {
        const falseEdge = edgeFrom(node.id, 'false');
        return falseEdge ? runNode(falseEdge.target, output, depth + 1) : output;
      }
      const edge = edgeFrom(node.id, nextPort);
      return edge ? runNode(edge.target, output, depth + 1) : output;
    } catch (error) {
      await recordStep(node, 'failed', incoming, output, startedAt, error?.message || String(error));
      throw error;
    }
  }

  const startNode = nodes.find((node) => node.type === 'start');
  try {
    const result = await runNode(startNode.id);
    const finalRun = await finishActionBlueprintRun(ownerUserId, run.id, { status: 'done' });
    return { ok: true, run: finalRun, result, executed, flow, nodeOutputs };
  } catch (error) {
    const finalRun = await finishActionBlueprintRun(ownerUserId, run.id, { status: 'failed', error: error?.message || String(error) });
    return { ok: false, run: finalRun, error: error?.message || String(error), executed, flow, nodeOutputs };
  }
}

const PVD_PROVIDER_KEYS = ['youtube', 'tiktok', 'chzzk_clip', 'cime_clip'];
const PVD_DURATION_SYNC_PROVIDERS = new Set(['tiktok', 'chzzk_clip', 'cime_clip']);

function getDefaultPvdProviders() {
  return {
    youtube: true,
    tiktok: false,
    chzzk_clip: true,
    cime_clip: false,
  };
}

function normalizePvdProviders(value) {
  const defaults = getDefaultPvdProviders();
  const input = value && typeof value === 'object' ? value : {};
  return PVD_PROVIDER_KEYS.reduce((acc, key) => {
    acc[key] = input[key] == null ? defaults[key] : input[key] === true;
    return acc;
  }, {});
}

function getPvdProviderLabel(provider) {
  if (provider === 'youtube') return 'YouTube';
  if (provider === 'tiktok') return 'TikTok';
  if (provider === 'chzzk_clip') return 'CHZZK 클립';
  if (provider === 'cime_clip') return 'CIME 클립';
  return '영상';
}

function shouldAwaitPvdDurationSync(provider, mediaDurationSec, playSec = null) {
  const explicitPlay = Number(playSec);
  if (Number.isFinite(explicitPlay) && explicitPlay > 0) return false;
  if (!PVD_DURATION_SYNC_PROVIDERS.has(String(provider || '').toLowerCase())) return false;
  return !Number.isFinite(Number(mediaDurationSec)) || Number(mediaDurationSec) <= 0;
}

function findFirstChzzkClipMp4Url(cardPayload) {
  const candidates = [];
  const seen = new Set();

  const normalizeCandidate = (value) => String(value || '')
    .trim()
    .replace(/\\u0026/ig, '&')
    .replace(/\\\//g, '/')
    .replace(/[),.;]+$/g, '');

  const addCandidate = (value, context = '') => {
    const text = normalizeCandidate(value);
    if (!text) return;

    const urls = [];
    if (/^https?:\/\//i.test(text)) urls.push(text);
    for (const match of text.matchAll(/https?:\/\/[^\s"'<>\\]+?\.mp4(?:\?[^\s"'<>\\]*)?(?:#[^\s"'<>\\]*)?/ig)) {
      urls.push(match[0]);
    }

    for (const rawUrl of urls) {
      const url = normalizeCandidate(rawUrl);
      if (!/^https?:\/\//i.test(url) || !/\.mp4(?:$|[?#])/i.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      candidates.push({ url, context: String(context || '') });
    }
  };

  const addCanonicalMpdBaseUrls = (payload) => {
    const mpdList = payload?.body?.card?.content?.vod?.playback?.MPD;
    for (const mpd of Array.isArray(mpdList) ? mpdList : []) {
      for (const period of Array.isArray(mpd?.Period) ? mpd.Period : []) {
        for (const adaptation of Array.isArray(period?.AdaptationSet) ? period.AdaptationSet : []) {
          for (const representation of Array.isArray(adaptation?.Representation) ? adaptation.Representation : []) {
            for (const baseUrl of Array.isArray(representation?.BaseURL) ? representation.BaseURL : []) {
              addCandidate(baseUrl, `${adaptation?.['@mimeType'] || ''} ${representation?.['@mimeType'] || ''} ${representation?.['@codecs'] || ''} canonical-mpd-baseurl`);
            }
          }
        }
      }
    }
  };

  const addCandidatesFromSerializedPayload = (payload) => {
    let serialized = '';
    try { serialized = JSON.stringify(payload || ''); } catch { serialized = ''; }
    if (!serialized) return;
    const normalized = normalizeCandidate(serialized)
      .replace(/&amp;/g, '&')
      .replace(/%5Cu0026/ig, '&');
    for (const match of normalized.matchAll(/https?:\/\/[^"'<>\s\\]+?\.mp4(?:\?[^"'<>\s\\]*)?(?:#[^"'<>\s\\]*)?/ig)) {
      addCandidate(match[0], 'serialized-payload');
    }
  };

  const visit = (node, context = '', depth = 0) => {
    if (node == null || depth > 14) return;
    if (typeof node === 'string' || typeof node === 'number') {
      addCandidate(node, context);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, context, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;

    const objectContext = [
      context,
      node.mimeType,
      node.contentType,
      node.type,
      node.codecs,
      node.width,
      node.height,
      node.label,
      node.name,
    ].filter(Boolean).join(' ');

    for (const [key, value] of Object.entries(node)) {
      const nextContext = `${objectContext} ${key}`;
      if (typeof value === 'string' || typeof value === 'number') addCandidate(value, nextContext);
      visit(value, nextContext, depth + 1);
    }
  };

  addCanonicalMpdBaseUrls(cardPayload);
  visit(cardPayload);
  addCandidatesFromSerializedPayload(cardPayload);
  if (!candidates.length) return null;

  const scoreCandidate = (candidate) => {
    const haystack = `${candidate.url} ${candidate.context}`.toLowerCase();
    let score = 0;
    if (/\.mp4(?:$|[?#])/i.test(candidate.url)) score += 100;
    if (/\bvideo\b|video\//i.test(haystack)) score += 50;
    if (/\baudio\b|audio\//i.test(haystack)) score -= 100;
    const height = haystack.match(/(?:height|resolution|label|[_-])\D*(\d{3,4})p?\b/i);
    if (height) score += Math.min(50, Math.floor(Number(height[1]) / 40));
    if (/1080|720|480/i.test(haystack)) score += 10;
    return score;
  };

  return candidates
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .map((candidate) => candidate.url)[0] || null;
}

function extractTikTokId(url) {
  const text = String(url || '').trim();
  const direct = text.match(/(?:^|\/)(\d{15,25})(?:$|[/?#])/);
  if (/^\d{15,25}$/.test(text)) return text;
  try {
    const u = new URL(text);
    if (!/(^|\.)tiktok\.com$/i.test(u.hostname)) return null;
    const player = u.pathname.match(/^\/player\/v1\/(\d{15,25})/);
    if (player) return player[1];
    const video = u.pathname.match(/\/video\/(\d{15,25})/);
    if (video) return video[1];
    if (direct) return direct[1];
  } catch { }
  return null;
}

function extractChzzkClipId(url) {
  const text = String(url || '').trim();
  const inline = text.match(/chzzk\.naver\.com\/(?:embed\/clip|clips)\/([A-Za-z0-9_-]+)/i);
  if (inline) return inline[1];
  try {
    const u = new URL(text);
    if (!/(^|\.)chzzk\.naver\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/(?:embed\/clip|clips)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

function extractCimeClipId(url) {
  const text = String(url || '').trim();
  const inline = text.match(/(?:ci\.me|cime\.kr)\/clips\/([A-Za-z0-9_-]+)/i);
  if (inline) return inline[1];
  try {
    const u = new URL(text);
    if (!/(^|\.)ci\.me$/i.test(u.hostname) && !/(^|\.)cime\.kr$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/clips\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

function getChzzkClipHeaders(clipId) {
  return {
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://chzzk.naver.com',
    Referer: `https://chzzk.naver.com/clips/${encodeURIComponent(String(clipId || ''))}`,
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  };
}

function normalizeChzzkClipTitle(value) {
  const title = String(value || '').replace(/\s+/g, ' ').trim();
  if (!title || title === '치지직 CHZZK' || title === 'CHZZK') return null;
  if (/일시적인 오류가 발생하였습니다/i.test(title)) return null;
  return title;
}

function extractChzzkClipTitle(payload) {
  const candidates = [
    payload?.clipTitle,
    payload?.title,
    payload?.clip?.clipTitle,
    payload?.content?.clipTitle,
    payload?.content?.title,
    payload?.body?.card?.content?.clipTitle,
    payload?.body?.card?.content?.title,
    payload?.body?.content?.clipTitle,
    payload?.body?.content?.title,
  ];
  for (const candidate of candidates) {
    const title = normalizeChzzkClipTitle(candidate);
    if (title) return title;
  }
  return null;
}

function createChzzkClipPlaybackUnavailableError(reason, details = {}) {
  const error = new Error('clip_playback_unavailable');
  error.code = 'clip_playback_unavailable';
  error.provider = 'chzzk_clip';
  error.reason = String(reason || 'unknown');
  error.details = details;
  return error;
}

function logChzzkClipPlaybackFailure(context, error) {
  if (error?.code !== 'clip_playback_unavailable') return;
  console.warn('[pvd:chzzk-clip] playback url unavailable', {
    context,
    reason: error.reason || null,
    ...(error.details && typeof error.details === 'object' ? error.details : {}),
  });
}

async function fetchChzzkClipInfo(clipId) {
  const id = String(clipId || '').trim();
  if (!id) return null;
  try {
    const r = await axios.get(`${String(CHZZK_UNOFFICIAL_API_BASE || 'https://api.chzzk.naver.com').replace(/\/$/, '')}/service/v1/clips/${encodeURIComponent(id)}/detail`, {
      params: { optionalProperties: 'COMMENT' },
      timeout: 7000,
      headers: getChzzkClipHeaders(id),
    });
    const clip = r?.data?.content || null;
    if (!clip) return null;
    let title = extractChzzkClipTitle(clip);
    const rawDuration = Number(clip.duration);
    const durationSec = Number.isFinite(rawDuration) && rawDuration > 0
      ? Math.ceil(rawDuration > 10000 ? rawDuration / 1000 : rawDuration)
      : null;
    let playbackUrl = findFirstChzzkClipMp4Url(clip);
    const videoId = clip.videoId || null;
    const seedMediaIds = Array.from(new Set([videoId, id].filter(Boolean).map((value) => String(value))));
    const cardFetchErrors = [];
    for (const seedMediaId of seedMediaIds) {
      if (playbackUrl) break;
      try {
        const card = await axios.get('https://creatorhub-api.naver.com/api/v5.0/clipviewer/card', {
          params: {
            userInteraction: true,
            seedType: 'SPECIFIC',
            serviceType: 'CHZZK',
            seedMediaId,
          },
          timeout: 7000,
          headers: getChzzkClipHeaders(id),
        });
        title = title || extractChzzkClipTitle(card?.data);
        playbackUrl = findFirstChzzkClipMp4Url(card?.data);
      } catch (error) {
        cardFetchErrors.push({
          seedMediaId,
          status: error?.response?.status || null,
          code: error?.code || null,
          message: error?.message || String(error),
        });
      }
    }
    const playbackUnavailableReason = playbackUrl
      ? null
      : !videoId
        ? 'video_id_missing'
        : cardFetchErrors.length >= seedMediaIds.length
          ? 'card_fetch_failed'
          : 'mp4_not_found_in_card';
    return {
      raw: clip,
      title,
      durationSec,
      playbackUrl,
      playbackUnavailableReason,
      cardFetchErrors,
      thumbnailUrl: clip.thumbnailImageUrl || null,
      videoId,
      adult: clip.adult === true,
      krOnlyViewing: clip.krOnlyViewing === true,
      vodStatus: clip.vodStatus || null,
    };
  } catch {
    return null;
  }
}

function getDrawingQueue(sid) {
  if (!drawingDonationQueues.has(sid)) drawingDonationQueues.set(sid, []);
  return drawingDonationQueues.get(sid);
}

function getDefaultDrawingDonationSettings() {
  return {
    enabled: false,
    pricingMode: 'fixed',
    costPoints: 100,
    inkCostPerUnit: 1,
    approvalMode: 'manual',
    replayMaxSec: 12,
    resultHoldSec: 8,
    maxStrokes: 120,
    maxPoints: 6000,
    submitCooldownSec: 20,
    perUserQueueLimit: 3,
    canvas: { widthRatio: 16, heightRatio: 9 },
  };
}

function normalizeDrawingDonationSettings(input = {}) {
  const defaults = getDefaultDrawingDonationSettings();
  const source = input && typeof input === 'object' ? input : {};
  const canvas = source.canvas && typeof source.canvas === 'object' ? source.canvas : {};
  return {
    enabled: source.enabled === true,
    pricingMode: String(source.pricingMode || source.costMode || defaults.pricingMode) === 'ink' ? 'ink' : 'fixed',
    costPoints: Math.max(0, Math.floor(Number(source.costPoints ?? defaults.costPoints) || defaults.costPoints)),
    inkCostPerUnit: Math.max(0, Math.min(1000, Number(source.inkCostPerUnit ?? defaults.inkCostPerUnit) || 0)),
    approvalMode: String(source.approvalMode || defaults.approvalMode) === 'auto' ? 'auto' : 'manual',
    replayMaxSec: Math.max(1, Math.min(60, Math.floor(Number(source.replayMaxSec ?? defaults.replayMaxSec) || defaults.replayMaxSec))),
    resultHoldSec: Math.max(1, Math.min(120, Math.floor(Number(source.resultHoldSec ?? defaults.resultHoldSec) || defaults.resultHoldSec))),
    maxStrokes: Math.max(1, Math.min(1000, Math.floor(Number(source.maxStrokes ?? defaults.maxStrokes) || defaults.maxStrokes))),
    maxPoints: Math.max(10, Math.min(50000, Math.floor(Number(source.maxPoints ?? defaults.maxPoints) || defaults.maxPoints))),
    submitCooldownSec: Math.max(0, Math.min(3600, Math.floor(Number(source.submitCooldownSec ?? defaults.submitCooldownSec) || 0))),
    perUserQueueLimit: Math.max(0, Math.min(50, Math.floor(Number(source.perUserQueueLimit ?? defaults.perUserQueueLimit) || 0))),
    canvas: {
      widthRatio: Math.max(1, Math.min(32, Number(canvas.widthRatio ?? defaults.canvas.widthRatio) || defaults.canvas.widthRatio)),
      heightRatio: Math.max(1, Math.min(32, Number(canvas.heightRatio ?? defaults.canvas.heightRatio) || defaults.canvas.heightRatio)),
    },
  };
}

function computeDrawingInkUsage(strokes = []) {
  let rawInk = 0;
  for (const stroke of Array.isArray(strokes) ? strokes : []) {
    const brush = stroke?.brush || {};
    const points = Array.isArray(stroke?.points) ? stroke.points : [];
    if (!points.length) continue;
    const size = Math.max(0.002, Math.min(0.2, Number(brush.size ?? 0.012) || 0.012));
    const alpha = brush.type === 'eraser' ? 1 : Math.max(0.05, Math.min(1, Number(brush.alpha ?? 1) || 1));
    const toolFactor = brush.type === 'eraser' ? 0.35 : brush.type === 'airbrush' ? 1.25 : brush.type === 'brush' ? 1.1 : 1;
    if (points.length === 1) {
      rawInk += size * alpha * toolFactor * Math.max(0.5, Number(points[0].p || 1) || 1) * 0.2;
      continue;
    }
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const point = points[i];
      const dx = Number(point.x || 0) - Number(prev.x || 0);
      const dy = Number(point.y || 0) - Number(prev.y || 0);
      const distance = Math.sqrt(dx * dx + dy * dy);
      const pressure = Math.max(0.05, Math.min(2, ((Number(prev.p || 1) || 1) + (Number(point.p || 1) || 1)) / 2));
      rawInk += distance * size * alpha * pressure * toolFactor;
    }
  }
  const units = Math.max(1, Math.ceil(rawInk * 1000));
  return {
    raw: Number(rawInk.toFixed(6)),
    units,
  };
}

function calculateDrawingDonationCost(settings = {}, inkUsage = null) {
  const normalized = normalizeDrawingDonationSettings(settings);
  if (normalized.pricingMode === 'ink') {
    const units = Math.max(1, Number(inkUsage?.units || 1) || 1);
    return Math.max(0, Math.ceil(units * Number(normalized.inkCostPerUnit || 0)));
  }
  return Math.max(0, Math.floor(Number(normalized.costPoints || 0) || 0));
}

function compactDrawingStrokePoints(points = [], brush = {}) {
  if (!Array.isArray(points) || points.length <= 2) return Array.isArray(points) ? points : [];
  const size = Math.max(0.002, Math.min(0.2, Number(brush.size ?? 0.012) || 0.012));
  const minDistance = Math.max(0.0007, size * 0.04);
  const compacted = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = compacted[compacted.length - 1];
    const point = points[index];
    const dx = Number(point.x || 0) - Number(previous.x || 0);
    const dy = Number(point.y || 0) - Number(previous.y || 0);
    const distance = Math.sqrt(dx * dx + dy * dy);
    const elapsed = Number(point.t || 0) - Number(previous.t || 0);
    if (distance >= minDistance || elapsed >= 32) compacted.push(point);
  }
  const last = points[points.length - 1];
  const previous = compacted[compacted.length - 1];
  if (!previous || previous.x !== last.x || previous.y !== last.y || previous.t !== last.t) compacted.push(last);
  return compacted;
}

function normalizeDrawingPreviewImage(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!/^data:image\/(webp|png|jpeg);base64,[a-z0-9+/=]+$/i.test(text)) return null;
  return Buffer.byteLength(text, 'utf8') <= 384 * 1024 ? text : null;
}

async function maybeStoreDrawingStrokes(ownerSid, drawingId, strokes) {
  const key = `drawing-donations/${String(ownerSid || 'unknown').replace(/[^a-z0-9:_-]/gi, '_')}/${drawingId}/strokes.json`;
  try {
    return await uploadDrawingDonationObject(key, { version: 1, strokes }, 'application/json; charset=utf-8');
  } catch (error) {
    console.warn('[Drawing Donation] stroke storage fallback to DB:', error?.message || error);
    return null;
  }
}

function getDrawingLivePlaybackCacheKey(provider, channelId) {
  return `${String(provider || '').toLowerCase()}:${String(channelId || '').toLowerCase()}`;
}

async function fetchJsonWithTimeout(url, { timeoutMs = 6000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json,text/plain,*/*',
        'user-agent': 'Mozilla/5.0 AruBot/2.0',
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseChzzkLlhlsPlaybackUrl(payload = {}) {
  const candidates = ['livePlaybackJson', 'previewPlaybackJson', 'radioModePlaybackJson'];
  for (const key of candidates) {
    const raw = payload?.content?.[key];
    if (!raw || typeof raw !== 'string') continue;
    let playback = null;
    try {
      playback = JSON.parse(raw);
    } catch {
      continue;
    }
    const media = Array.isArray(playback?.media) ? playback.media : [];
    const llhls = media.find((item) => String(item?.mediaId || '').toLowerCase() === 'llhls');
    const path = String(llhls?.path || '').trim();
    if (/^https?:\/\/.+\.m3u8(\?.*)?$/i.test(path)) return path;
  }
  return null;
}

function parseCimePlaybackUrl(payload = {}) {
  const url = String(payload?.data?.playbackUrl || '').trim();
  return /^https?:\/\/.+\.m3u8(\?.*)?$/i.test(url) ? url : null;
}

async function resolveDrawingLivePlaybackUrl(provider, channelId) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedChannelId = String(channelId || '').trim().replace(/^@/, '');
  if (!normalizedChannelId || !['chzzk', 'cime'].includes(normalizedProvider)) return null;
  const cacheKey = getDrawingLivePlaybackCacheKey(normalizedProvider, normalizedChannelId);
  const cached = drawingLivePlaybackCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let playbackUrl = null;
  if (normalizedProvider === 'chzzk') {
    const url = `https://api.chzzk.naver.com/service/v3.3/channels/${encodeURIComponent(normalizedChannelId)}/live-detail`;
    playbackUrl = parseChzzkLlhlsPlaybackUrl(await fetchJsonWithTimeout(url, { headers: { referer: `https://chzzk.naver.com/live/${encodeURIComponent(normalizedChannelId)}` } }));
  } else if (normalizedProvider === 'cime') {
    const url = `https://ci.me/api/app/channels/${encodeURIComponent(normalizedChannelId)}/live`;
    playbackUrl = parseCimePlaybackUrl(await fetchJsonWithTimeout(url, { headers: { referer: `https://ci.me/@${encodeURIComponent(normalizedChannelId)}` } }));
  }

  const value = playbackUrl ? { provider: normalizedProvider, channelId: normalizedChannelId, playbackUrl, fetchedAt: new Date().toISOString() } : null;
  drawingLivePlaybackCache.set(cacheKey, { expiresAt: Date.now() + (value ? 15_000 : 5_000), value });
  if (drawingLivePlaybackCache.size > 200) {
    for (const [key, entry] of drawingLivePlaybackCache) {
      if (entry.expiresAt <= Date.now() || drawingLivePlaybackCache.size > 160) drawingLivePlaybackCache.delete(key);
    }
  }
  return value;
}

function buildDrawingLiveSurfaceFromAccount(account = {}, liveState = null) {
  const provider = String(account.provider || '').toLowerCase();
  const channelId = String(account.channel_id || account.channelId || account.platform_user_id || '').trim();
  const channelName = account.channel_name || account.channelName || channelId;
  const handle = String(account.channel_handle || account.channelHandle || '').trim();
  const metadata = account.metadata && typeof account.metadata === 'object' ? account.metadata : {};
  const publicProfile = metadata.publicProfile && typeof metadata.publicProfile === 'object' ? metadata.publicProfile : {};
  const profileUrl = String(account.profile_url || account.profileUrl || publicProfile.profileUrl || publicProfile.url || metadata.profileUrl || '').trim();
  const liveUrl = String(publicProfile.liveUrl || metadata.liveUrl || '').trim();
  let watchUrl = '';
  let embedUrl = '';
  if (provider === 'youtube') {
    const youtubeChannelId = channelId || publicProfile.channelId || '';
    watchUrl = liveUrl || profileUrl || (youtubeChannelId ? `https://www.youtube.com/channel/${encodeURIComponent(youtubeChannelId)}/live` : '');
    embedUrl = youtubeChannelId ? `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(youtubeChannelId)}&autoplay=1&mute=1&controls=0&modestbranding=1&playsinline=1` : '';
  } else if (provider === 'chzzk') {
    watchUrl = liveUrl || profileUrl || (channelId ? `https://chzzk.naver.com/live/${encodeURIComponent(channelId)}` : '');
    embedUrl = watchUrl;
  } else if (provider === 'cime') {
    const cimeId = String(handle || channelId || '').trim().replace(/^@/, '');
    watchUrl = (cimeId ? `https://ci.me/@${encodeURIComponent(cimeId)}/live` : '') || liveUrl || profileUrl;
    embedUrl = watchUrl;
  }
  return {
    provider,
    channelId,
    handle,
    channelName,
    avatarUrl: account.avatar_url || account.avatarUrl || publicProfile.avatarUrl || null,
    live: liveState?.provider === provider ? !!liveState.live : null,
    watchUrl,
    embedUrl,
    hlsChannelId: provider === 'cime' ? (handle || channelId).replace(/^@/, '') : channelId,
    hlsSupported: provider === 'chzzk' || provider === 'cime',
    embeddable: provider === 'youtube',
  };
}

async function collectDrawingLiveSurfacesForSid(sid) {
  const ownerUserId = String(sid || '').replace(/^user:/, '');
  if (!ownerUserId) return [];
  const accounts = await listPlatformAccounts(ownerUserId).catch(() => []);
  const surfaces = [];
  for (const account of accounts || []) {
    const provider = String(account.provider || '').toLowerCase();
    let liveState = liveStatusCache.get(sid) || null;
    if (provider === 'youtube') {
      liveState = liveState?.provider === 'youtube' ? liveState : null;
    } else if (provider === 'chzzk') {
      liveState = liveState?.provider === 'chzzk' ? liveState : null;
    } else if (provider === 'cime') {
      liveState = liveState?.provider === 'cime' ? liveState : null;
    }
    const surface = buildDrawingLiveSurfaceFromAccount(account, liveState);
    if (surface.provider && surface.channelId) surfaces.push(surface);
  }
  return surfaces;
}

function normalizeBlockedBotUsers(input) {
  const items = Array.isArray(input) ? input : [];
  const seen = new Set();
  return items.map((item) => ({
    userId: String(item?.userId || '').trim(),
    username: String(item?.username || '').trim() || null,
    reason: String(item?.reason || '').trim() || null,
    createdAt: item?.createdAt || new Date().toISOString(),
  })).filter((item) => {
    if (!item.userId) return false;
    const key = item.userId.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildBotUserBlockKeys(userId, provider = null, extra = []) {
  const keys = new Set();
  const add = (value) => {
    const text = String(value || '').trim();
    if (!text) return;
    keys.add(text.toLowerCase());
    const raw = text.includes(':') ? text.split(':').slice(1).join(':') : text;
    if (raw) keys.add(raw.toLowerCase());
    const p = String(provider || '').trim().toLowerCase();
    if (p && raw) keys.add(`${p}:${raw}`.toLowerCase());
  };
  add(userId);
  for (const value of Array.isArray(extra) ? extra : []) add(value);
  return keys;
}

function findBlockedBotUser(settings = {}, userId, provider = null, extra = []) {
  const keys = buildBotUserBlockKeys(userId, provider, extra);
  if (!keys.size) return null;
  for (const item of normalizeBlockedBotUsers(settings.blockedBotUsers)) {
    const itemKeys = buildBotUserBlockKeys(item.userId);
    for (const key of itemKeys) {
      if (keys.has(key)) return item;
    }
  }
  return null;
}

function normalizeDrawingStrokePayload(body = {}, settings = getDefaultDrawingDonationSettings()) {
  const strokes = Array.isArray(body.strokes) ? body.strokes : [];
  if (!strokes.length) {
    const error = new Error('drawing_empty');
    error.status = 400;
    throw error;
  }
  const maxStrokes = Math.max(1, Number(settings.maxStrokes || 120));
  const maxPoints = Math.max(10, Number(settings.maxPoints || 6000));
  if (strokes.length > maxStrokes) {
    const error = new Error('too_many_strokes');
    error.status = 400;
    throw error;
  }

  let rawPointCount = 0;
  const normalized = strokes.map((stroke, strokeIndex) => {
    const brush = stroke?.brush && typeof stroke.brush === 'object' ? stroke.brush : {};
    const points = Array.isArray(stroke?.points) ? stroke.points : [];
    rawPointCount += points.length;
    if (rawPointCount > maxPoints) {
      const error = new Error('too_many_points');
      error.status = 400;
      throw error;
    }
    const normalizedBrush = {
      type: ['pen', 'crayon', 'brush', 'marker', 'highlighter', 'airbrush', 'eraser'].includes(String(brush.type || 'pen')) ? String(brush.type || 'pen') : 'pen',
      color: /^#[0-9a-f]{6}$/i.test(String(brush.color || '')) ? String(brush.color) : '#ff6b9a',
      alpha: String(brush.type || 'pen') === 'eraser' ? 1 : Math.max(0.05, Math.min(1, Number(brush.alpha ?? 1) || 1)),
      size: Math.max(0.002, Math.min(0.2, Number(brush.size ?? 0.012) || 0.012)),
    };
    const normalizedPoints = points.map((point, pointIndex) => ({
      x: Math.max(0, Math.min(1, Number(point?.x ?? 0) || 0)),
      y: Math.max(0, Math.min(1, Number(point?.y ?? 0) || 0)),
      p: Math.max(0.05, Math.min(2, Number(point?.p ?? 1) || 1)),
      t: Math.max(0, Math.floor(Number(point?.t ?? pointIndex * 16) || 0)),
    }));
    return {
      id: String(stroke?.id || `s${strokeIndex + 1}`),
      brush: normalizedBrush,
      points: compactDrawingStrokePoints(normalizedPoints, normalizedBrush),
    };
  }).filter((stroke) => stroke.points.length > 0);

  if (!normalized.length) {
    const error = new Error('drawing_empty');
    error.status = 400;
    throw error;
  }

  const pointCount = normalized.reduce((sum, stroke) => sum + stroke.points.length, 0);
  const jsonSize = Buffer.byteLength(JSON.stringify(normalized), 'utf8');
  if (jsonSize > 1024 * 1024) {
    const error = new Error('drawing_too_large');
    error.status = 400;
    throw error;
  }

  const ink = computeDrawingInkUsage(normalized);
  return { strokes: normalized, pointCount, rawPointCount, jsonSize, ink };
}

function computeDrawingReplay(strokes, replayMaxSec) {
  const idleCapMs = 120;
  let activeMs = 0;
  for (const stroke of strokes || []) {
    const points = Array.isArray(stroke.points) ? stroke.points : [];
    for (let i = 1; i < points.length; i += 1) {
      activeMs += Math.min(idleCapMs, Math.max(0, Number(points[i].t || 0) - Number(points[i - 1].t || 0)));
    }
  }
  activeMs = Math.max(1000, activeMs);
  const targetReplayMs = Math.max(1000, Math.min(Math.max(1, Number(replayMaxSec || 12)) * 1000, activeMs));
  return {
    activeDrawMs: activeMs,
    targetReplayMs,
    speed: Number((activeMs / targetReplayMs).toFixed(2)),
    idleCapMs,
  };
}

function drawingTokenFromSid(sid) {
  const uid = String(sid || '').replace(/^user:/, '');
  const existingSecret = process.env.DRAWING_DONATION_TOKEN_SECRET || process.env.PVD_TOKEN_SECRET || '';
  if (uid && existingSecret) {
    const h = crypto.createHmac('sha256', existingSecret).update(`drawing:${uid}`).digest('base64url');
    return `draw_${h.slice(0, 32)}`;
  }
  return `draw_${pvdRandomToken(24)}`;
}

async function getDrawingSidByToken(token) {
  const text = String(token || '').trim();
  if (!text) return null;
  if (drawingTokenToSid.has(text)) return drawingTokenToSid.get(text);
  for (const sid of Array.from(activeSids?.keys?.() || [])) {
    const settings = await getBotSettings(sid).catch(() => null) || {};
    if (settings.drawingDonationViewerToken === text) {
      drawingTokenToSid.set(text, sid);
      return sid;
    }
  }
  return null;
}

function getCurrentDrawingItem(sid) {
  const queue = getDrawingQueue(sid);
  return queue.find((item) => item.status === 'approved' || item.status === 'playing') || null;
}

async function listDrawingQueueForSid(sid) {
  try {
    return await listDrawingDonationItems(sid, { limit: 100 });
  } catch (error) {
    console.warn('[Drawing Donation] DB queue list failed; using memory fallback:', error?.message || error);
    return getDrawingQueue(sid);
  }
}

async function getDrawingQueueSnapshot(sid, reason = 'queue_changed') {
  const items = await listDrawingQueueForSid(sid).catch(() => getDrawingQueue(sid));
  const currentItem = (items || []).find((item) => item.status === 'playing' || item.status === 'approved') || null;
  return {
    type: 'drawing-donation.queue',
    reason,
    items: items || [],
    currentItem,
    waitingItems: (items || []).filter((item) => item.id !== currentItem?.id),
    queueSize: Array.isArray(items) ? items.length : 0,
    serverNow: Date.now(),
  };
}

async function notifyDrawingAdminSubscribers(sid, reason = 'queue_changed') {
  const set = drawingAdminSockets.get(sid);
  if (!set || !set.size) return;
  const payload = await getDrawingQueueSnapshot(sid, reason).catch(() => null);
  if (!payload) return;
  const text = JSON.stringify(payload);
  for (const ws of Array.from(set)) {
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === 1) ws.send(text, { compress: false });
      else set.delete(ws);
    } catch {
      set.delete(ws);
    }
  }
  if (set.size === 0) drawingAdminSockets.delete(sid);
}

async function notifyDrawingSubscribers(sid, reason = 'queue_changed') {
  const set = drawingOverlaySockets.get(sid);
  if (!set || !set.size) return;
  const item = await getCurrentDrawingItemForSid(sid).catch(() => null);
  const text = JSON.stringify({
    type: 'drawing-donation.current',
    reason,
    item,
    serverNow: Date.now(),
  });
  for (const ws of Array.from(set)) {
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === 1) ws.send(text, { compress: false });
      else set.delete(ws);
    } catch {
      set.delete(ws);
    }
  }
  if (set.size === 0) drawingOverlaySockets.delete(sid);
}

async function getDrawingItemForSid(sid, id, options = {}) {
  try {
    return await getDrawingDonationItem(sid, id, options);
  } catch (error) {
    console.warn('[Drawing Donation] DB item lookup failed; using memory fallback:', error?.message || error);
    const item = getDrawingQueue(sid).find((entry) => entry.id === id) || null;
    if (!item) return null;
    if (options.includeStrokes) return item;
    const { strokes, ...withoutStrokes } = item;
    return withoutStrokes;
  }
}

async function getCurrentDrawingItemForSid(sid) {
  try {
    return await getCurrentDrawingDonationItem(sid);
  } catch (error) {
    console.warn('[Drawing Donation] DB current lookup failed; using memory fallback:', error?.message || error);
    const item = getCurrentDrawingItem(sid);
    if (item && item.status === 'approved') {
      item.status = 'playing';
      item.playingAt = item.playingAt || new Date().toISOString();
    }
    return item || null;
  }
}

async function updateDrawingItemStatusForSid(sid, id, status, extra = {}) {
  try {
    return await updateDrawingDonationItemStatus(sid, id, status, extra);
  } catch (error) {
    console.warn('[Drawing Donation] DB status update failed; using memory fallback:', error?.message || error);
    const item = getDrawingQueue(sid).find((entry) => entry.id === id) || null;
    if (!item) return null;
    item.status = status;
    item.updatedAt = new Date().toISOString();
    if (status === 'approved') item.approvedAt = item.approvedAt || item.updatedAt;
    if (status === 'playing') item.playingAt = item.playingAt || item.updatedAt;
    if (status === 'done') item.doneAt = item.doneAt || item.updatedAt;
    if (status === 'rejected') item.rejectedAt = item.rejectedAt || item.updatedAt;
    if (extra.pointRefunded != null) item.pointRefunded = extra.pointRefunded === true;
    return item;
  }
}

async function reorderDrawingItemsForSid(sid, ids = []) {
  try {
    return await reorderDrawingDonationItems(sid, ids);
  } catch (error) {
    console.warn('[Drawing Donation] DB reorder failed; using memory fallback:', error?.message || error);
    const q = getDrawingQueue(sid);
    const byId = new Map(q.map((item) => [String(item.id), item]));
    const ordered = ids.map((id) => byId.get(String(id))).filter(Boolean);
    const orderedIds = new Set(ordered.map((item) => String(item.id)));
    const remaining = q.filter((item) => !orderedIds.has(String(item.id)));
    const next = [...ordered, ...remaining].map((item, index) => ({ ...item, position: index }));
    drawingDonationQueues.set(sid, next);
    return next;
  }
}

async function deleteDrawingItemForSid(sid, id) {
  try {
    return await deleteDrawingDonationItem(sid, id);
  } catch (error) {
    console.warn('[Drawing Donation] DB delete failed; using memory fallback:', error?.message || error);
    const q = getDrawingQueue(sid);
    const index = q.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    const [item] = q.splice(index, 1);
    return item;
  }
}

async function resolveDrawingDonationSettingsForBalance(balance) {
  const rawCandidates = [
    balance?.canonicalChannelUid,
    balance?.channelUid,
    String(balance?.canonicalChannelUid || '').replace(/^user:/, ''),
    String(balance?.channelUid || '').replace(/^user:/, ''),
  ].map((value) => String(value || '').trim()).filter(Boolean);
  const candidates = Array.from(new Set(rawCandidates.flatMap((value) => [value, value.startsWith('user:') ? value : `user:${value}`])));
  for (const sid of candidates) {
    const settings = await getBotSettings(sid).catch(() => null);
    const drawing = normalizeDrawingDonationSettings(settings?.drawingDonation);
    if (drawing.enabled) return { sid, settings, drawing };
  }
  return null;
}

async function collectViewerDrawingDonationStreamers(ownerUserId) {
  const platforms = await listPlatformAccounts(ownerUserId).catch(() => []);
  const identityKeys = collectViewerPointIdentityKeys(ownerUserId, platforms);
  const balances = await listViewerPointBalancesForUserIds(identityKeys);
  const entries = [];
  for (const balance of balances || []) {
    const resolved = await resolveDrawingDonationSettingsForBalance(balance);
    if (!resolved) continue;
    const blocked = findBlockedBotUser(resolved.settings, ownerUserId, null, identityKeys);
    const liveSurfaces = await collectDrawingLiveSurfacesForSid(resolved.sid).catch(() => []);
    entries.push({
      channelUid: balance.channelUid,
      canonicalChannelUid: balance.canonicalChannelUid || null,
      channelName: balance.channelName || balance.channelUid,
      avatarUrl: balance.avatarUrl || null,
      provider: balance.provider || null,
      points: Number(balance.points || 0),
      identities: balance.identities || [],
      liveSurfaces,
      drawingDonation: {
        enabled: true,
        pricingMode: resolved.drawing.pricingMode,
        costPoints: resolved.drawing.costPoints,
        inkCostPerUnit: resolved.drawing.inkCostPerUnit,
        approvalMode: resolved.drawing.approvalMode,
        replayMaxSec: resolved.drawing.replayMaxSec,
        resultHoldSec: resolved.drawing.resultHoldSec,
        canvas: resolved.drawing.canvas,
        blocked: !!blocked,
        blockReason: blocked?.reason || null,
      },
    });
  }
  return { platforms, identityKeys, streamers: entries };
}

function applyDrawingPointCost(balance, cost) {
  let remaining = Math.max(0, Number(cost || 0));
  const deductions = [];
  const identities = (Array.isArray(balance?.identities) ? balance.identities : [])
    .map((identity) => ({
      userId: String(identity?.userId || '').trim(),
      username: String(identity?.username || '').trim(),
      points: Math.max(0, Number(identity?.points || 0)),
    }))
    .filter((identity) => identity.userId && identity.points > 0)
    .sort((a, b) => b.points - a.points);

  for (const identity of identities) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, identity.points);
    deductions.push({ userId: identity.userId, username: identity.username || null, amount });
    remaining -= amount;
  }

  return { ok: remaining <= 0, deductions, remaining };
}

async function fetchCimeClipInfo(clipId) {
  const id = String(clipId || '').trim();
  if (!id) return null;
  try {
    const r = await axios.get(`https://ci.me/json/clips/${encodeURIComponent(id)}`, {
      timeout: 7000,
      headers: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
    });
    const clips = r?.data?.bodyData?.clips;
    const clip = Array.isArray(clips)
      ? (clips.find((item) => String(item?.id || '') === id) || clips[0])
      : null;
    if (!clip) return null;
    const rawDuration = Number(clip.duration ?? clip.playback?.duration);
    const durationSec = Number.isFinite(rawDuration) && rawDuration > 0
      ? Math.ceil(rawDuration > 10000 ? rawDuration / 1000 : rawDuration)
      : null;
    return {
      raw: clip,
      title: clip.title || null,
      durationSec,
      playbackUrl: clip.playback?.url || null,
      playbackFile: clip.playback?.file || null,
      thumbnailUrl: clip.coverImageUrl || clip.imageUrl || null,
      layout: clip.layout || null,
      channelName: clip.channel?.name || null,
    };
  } catch {
    return null;
  }
}

function parseHtmlMeta(html) {
  const source = String(html || '');
  const readMeta = (name) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
    const m = source.match(re);
    return m ? m[1].replace(/&amp;/g, '&').trim() : null;
  };
  const titleMatch = source.match(/<title>([^<]+)<\/title>/i);
  let jsonLd = null;
  const jsonLdMatch = source.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try { jsonLd = JSON.parse(jsonLdMatch[1]); } catch { jsonLd = null; }
  }
  const durationIso = jsonLd?.duration || null;
  return {
    title: readMeta('og:title') || jsonLd?.name || (titleMatch ? titleMatch[1].trim() : null),
    thumbnailUrl: readMeta('og:image') || jsonLd?.thumbnailUrl || null,
    durationSec: durationIso ? parseIso8601Duration(durationIso) : null,
  };
}

async function fetchGenericPageMetadata(url) {
  try {
    const r = await axios.get(url, {
      timeout: 7000,
      responseType: 'text',
      headers: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
    });
    return parseHtmlMeta(r?.data || '');
  } catch {
    return { title: null, thumbnailUrl: null, durationSec: null };
  }
}

async function resolveTikTokFinalUrl(url) {
  const text = String(url || '').trim();
  if (!text) return text;
  try {
    const r = await axios.get(text, {
      timeout: 7000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return r?.request?.res?.responseUrl || text;
  } catch {
    return text;
  }
}

async function parsePvdMediaInput(input, { allowSearch = true } = {}) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const chzzkClipId = extractChzzkClipId(raw);
  if (chzzkClipId) {
    return {
      provider: 'chzzk_clip',
      mediaId: chzzkClipId,
      originalUrl: `https://chzzk.naver.com/clips/${chzzkClipId}`,
      embedUrl: null,
    };
  }

  const cimeClipId = extractCimeClipId(raw);
  if (cimeClipId) {
    return {
      provider: 'cime_clip',
      mediaId: cimeClipId,
      originalUrl: `https://ci.me/clips/${cimeClipId}`,
      embedUrl: `https://ci.me/clips/${cimeClipId}`,
    };
  }

  const youtubeId = extractYouTubeId(raw);
  if (youtubeId) {
    return {
      provider: 'youtube',
      mediaId: youtubeId,
      originalUrl: /^https?:\/\//i.test(raw) ? raw : `https://youtu.be/${youtubeId}`,
      embedUrl: null,
    };
  }

  let tiktokId = extractTikTokId(raw);
  let tiktokUrl = raw;
  if (!tiktokId && /^https?:\/\//i.test(raw)) {
    try {
      const host = new URL(raw).hostname;
      if (/(^|\.)tiktok\.com$/i.test(host)) {
        tiktokUrl = await resolveTikTokFinalUrl(raw);
        tiktokId = extractTikTokId(tiktokUrl);
      }
    } catch { }
  }
  if (tiktokId) {
    const embed = new URL(`https://www.tiktok.com/player/v1/${tiktokId}`);
    embed.searchParams.set('autoplay', '1');
    embed.searchParams.set('controls', '1');
    embed.searchParams.set('progress_bar', '1');
    embed.searchParams.set('play_button', '1');
    embed.searchParams.set('volume_control', '1');
    embed.searchParams.set('fullscreen_button', '1');
    embed.searchParams.set('timestamp', '1');
    embed.searchParams.set('loop', '0');
    embed.searchParams.set('rel', '0');
    embed.searchParams.set('native_context_menu', '0');
    embed.searchParams.set('closed_caption', '0');
    return {
      provider: 'tiktok',
      mediaId: tiktokId,
      originalUrl: tiktokUrl,
      embedUrl: embed.toString(),
    };
  }

  if (allowSearch) {
    const found = await searchYouTubeVideoIdByQuery(raw).catch(() => null);
    if (found) {
      return {
        provider: 'youtube',
        mediaId: String(found),
        originalUrl: `https://youtu.be/${found}`,
        embedUrl: null,
      };
    }
  }

  return null;
}

async function resolvePvdMedia(input, settings = {}, { allowSearch = true } = {}) {
  const parsed = await parsePvdMediaInput(input, { allowSearch });
  if (!parsed) {
    const error = new Error('unsupported_media');
    error.code = 'unsupported_media';
    throw error;
  }

  const providers = normalizePvdProviders(settings.videoDonationProviders);
  if (providers[parsed.provider] !== true) {
    const error = new Error('provider_disabled');
    error.code = 'provider_disabled';
    error.provider = parsed.provider;
    throw error;
  }

  let title = null;
  let durationSec = null;
  let thumbnailUrl = null;

  if (parsed.provider === 'youtube') {
    const info = await fetchYouTubeInfo(parsed.mediaId);
    title = info?.title || null;
    durationSec = Number.isFinite(info?.durationSec) ? Number(info.durationSec) : null;
    thumbnailUrl = `https://i.ytimg.com/vi/${encodeURIComponent(parsed.mediaId)}/hqdefault.jpg`;
  } else if (parsed.provider === 'tiktok') {
    try {
      const r = await axios.get(`https://www.tiktok.com/oembed?url=${encodeURIComponent(parsed.originalUrl)}`, { timeout: 5000 });
      title = r?.data?.title || null;
      thumbnailUrl = r?.data?.thumbnail_url || null;
    } catch { }
    if (!title) title = `TikTok 영상 ${parsed.mediaId}`;
  } else {
    if (parsed.provider === 'chzzk_clip') {
      const clip = await fetchChzzkClipInfo(parsed.mediaId);
      if (clip?.playbackUrl) {
        parsed.embedUrl = clip.playbackUrl;
        parsed.originalUrl = `https://chzzk.naver.com/clips/${parsed.mediaId}`;
      } else {
        throw createChzzkClipPlaybackUnavailableError(clip?.playbackUnavailableReason || 'detail_fetch_failed', {
          clipId: parsed.mediaId,
          videoId: clip?.videoId || null,
          title: clip?.title || null,
          cardFetchErrors: clip?.cardFetchErrors || [],
        });
      }
      title = clip?.title || '제목을 불러오지 못한 치지직 클립';
      durationSec = Number.isFinite(clip?.durationSec) ? Number(clip.durationSec) : null;
      thumbnailUrl = clip?.thumbnailUrl || null;
    } else if (parsed.provider === 'cime_clip') {
      const clip = await fetchCimeClipInfo(parsed.mediaId);
      if (clip?.playbackUrl) {
        parsed.embedUrl = clip.playbackUrl;
        parsed.originalUrl = `https://ci.me/clips/${parsed.mediaId}`;
      }
      title = clip?.title || `${getPvdProviderLabel(parsed.provider)} ${parsed.mediaId}`;
      durationSec = Number.isFinite(clip?.durationSec) ? Number(clip.durationSec) : null;
      thumbnailUrl = clip?.thumbnailUrl || null;
    } else {
      const meta = await fetchGenericPageMetadata(parsed.originalUrl);
      title = meta.title || `${getPvdProviderLabel(parsed.provider)} ${parsed.mediaId}`;
      durationSec = Number.isFinite(meta.durationSec) ? Number(meta.durationSec) : null;
      thumbnailUrl = meta.thumbnailUrl || null;
    }
  }

  return {
    provider: parsed.provider,
    mediaId: parsed.mediaId,
    mediaUrl: parsed.originalUrl,
    embedUrl: parsed.embedUrl,
    title,
    durationSec,
    thumbnailUrl,
  };
}

async function executeActionVariableTokens(sid, text, context = {}) {
  const source = String(text || '');
  const matches = Array.from(source.matchAll(/\$\{\s*(?:action|automation|blueprint)::([^}]+)\s*\}/ig));
  if (!matches.length) return [];
  const ownerUserId = ownerUserIdFromSid(sid);
  if (!ownerUserId) return [];
  const jobs = [];
  for (const match of matches) {
    const actionId = String(match?.[1] || '').trim();
    if (!actionId) continue;
    try {
      const blueprint = await getActionBlueprint(ownerUserId, actionId).catch(() => null);
      if (blueprint?.version?.published) {
        const runResult = await executeActionBlueprint(ownerUserId, actionId, {
          ...context,
          source: context.source || 'action_variable',
          triggerRef: actionId
        });
        jobs.push({
          kind: 'blueprint',
          actionId,
          blueprintId: blueprint.id,
          blueprintName: blueprint.name || actionId,
          runId: runResult?.run?.id || null,
          ok: runResult?.ok !== false,
          result: runResult,
        });
      } else {
        const job = await queueAutomationJob(ownerUserId, {
          connectionId: null,
          jobType: 'action.variable',
          payload: {
            actionId,
            source: context.source || 'roulette',
            roulette: context.roulette || null,
            result: context.result || null,
            user: context.user || null,
            createdAt: new Date().toISOString(),
          },
        });
        jobs.push({ kind: 'automation_job', actionId, jobId: job?.id || null, job });
      }
    } catch (error) {
      console.error('[Action Variable] failed to enqueue action job', actionId, error?.message || error);
    }
  }
  return jobs;
}

function stripActionVariableTokens(text) {
  return String(text || '').replace(/\$\{\s*(?:action|automation|blueprint)::([^}]+)\s*\}/ig, '').trim();
}

async function executeAndStripActionVariableTokens(sid, text, context = {}) {
  const source = String(text || '');
  const hasActionToken = /\$\{\s*(?:action|automation|blueprint)::([^}]+)\s*\}/i.test(source);
  if (!hasActionToken) return { text: source, used: false, jobs: [] };
  const jobs = await executeActionVariableTokens(sid, source, context);
  return { text: stripActionVariableTokens(source), used: true, jobs };
}

async function startRouletteSpin(sid, rouletteName, userId, username, opts = {}) {
  const channelContext = await getChannelContext(sid);
  if (!channelContext) {
    console.error('[Roulette] Invalid channel context for sid:', sid);
    throw new Error('invalid_channel_context');
  }

  if (!validateChannelId(channelContext.channelId)) {
    console.error('[Roulette] Invalid channel ID:', channelContext.channelId);
    throw new Error('invalid_channel_id');
  }

  console.log(`[Roulette] Starting spin for channel: ${channelContext.channelId}, roulette: ${rouletteName}, user: ${username}`);

  const settings = await getBotSettings(sid) || {};
  const defs = getRouletteDefsFromSettings(settings);
  const def = defs.find(d => String(d.name).toLowerCase() === String(rouletteName || '').toLowerCase());

  if (!def) {
    console.error(`[Roulette] Roulette not found: ${rouletteName} for channel: ${channelContext.channelId}`);
    throw new Error('roulette_not_found');
  }
  const picked = chooseRouletteItem(def);

  let token = null;
  try {
    token = await getOrCreateViewerTokenSupabase(channelContext.channelId, 'roulette', sid, 'rlt').catch(() => null);
  } catch (error) {
    console.warn('[Roulette] Failed to load stable roulette viewer token from Supabase:', error?.message || error);
  }
  if (!token) {
    token = typeof settings.rouletteViewerToken === 'string' && settings.rouletteViewerToken.trim()
      ? String(settings.rouletteViewerToken).trim()
      : '';
  }
  if (!token) {
    token = 'rlt_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  }
  if (settings.rouletteViewerToken !== token) {
    try {
      await setBotSettings(sid, { ...settings, rouletteViewerToken: token });
    } catch (error) {
      console.warn('[Roulette] Failed to persist stable roulette viewer token:', error?.message || error);
    }
  }
  try {
    registerTokenChannelMapping(token, channelContext.channelId);
    rouletteTokenToSid.set(token, sid);
  } catch { }
  console.log(`[Roulette] Using stable viewer token for ${channelContext.channelId}: ${token.substring(0, 16)}...`);

  try {
    await insertRouletteSession({
      sid,
      token,
      channel_id: channelContext.channelId,
      roulette_name: def.name,
      user_id: userId,
      username,
      result_label: picked.label,
      result_value: picked.value,
      created_at: new Date().toISOString()
    });

    console.log(`[Roulette] Saved session to database - Channel: ${channelContext.channelId}, Token: ${token.substring(0, 16)}..., Result: ${picked.label}`);

  } catch (e) {
    console.error('[Roulette] Failed to save roulette session to database:', e?.message || e);

    console.error(`[Roulette] Database save failed for channel: ${channelContext.channelId}, user: ${username}, roulette: ${def.name}`);
  }

  await recordBotEventLogSafe(sid, {
    category: 'roulette',
    eventType: 'roulette_result',
    provider: providerFromLogContext(opts),
    channelUid: channelContext.channelId,
    viewerUserId: userId ? String(userId) : null,
    viewerName: username ? String(username) : null,
    pointDelta: Number(opts?.eventContext?.pointDelta || 0) || 0,
    pointBefore: opts?.eventContext?.pointBefore ?? null,
    pointAfter: opts?.eventContext?.pointAfter ?? null,
    triggerName: opts?.eventContext?.triggerName || opts?.source || null,
    targetName: def.name,
    summary: `룰렛 결과: ${def.name} · ${picked.label || '결과 없음'}`,
    resultLabel: picked.label || null,
    resultValue: picked.value != null ? String(picked.value) : null,
    metadata: {
      rouletteId: def.id || null,
      rouletteName: def.name,
      token,
      instant: opts?.instant === true,
      batchId: opts?.batchId || null,
      batchCount: Math.max(1, Number(opts?.batchCount ?? 1)),
      source: opts?.eventContext?.source || opts?.source || null,
    },
  });

  if (picked.value && typeof picked.value === 'string' && picked.value.trim()) {
    await executeActionVariableTokens(sid, picked.value, {
      source: 'roulette',
      roulette: { id: def.id || null, name: def.name },
      result: { label: picked.label, value: picked.value },
      user: { userId, username },
      chatPost: opts?.chatPost || null,
      platform: opts?.chatPost?.platform || null,
      channelUid: channelContext.channelId,
      channel: { channelUid: channelContext.channelId },
    });
    const commandValue = picked.value.replace(/\$\{\s*(?:action|automation|blueprint)::([^}]+)\s*\}/ig, '').trim();
    try {
      if (commandValue) {
        console.log(`[Roulette] Executing command from result: ${commandValue} for user: ${username}`);
        await executeRouletteResultCommand(sid, commandValue, userId, username, opts?.chatPost || null);
      }
    } catch (e) {
      console.error('[Roulette] Failed to execute result command:', e);
    }
  }
  // Broadcast to any connected viewers for this token, include 'instant' flag when requested
  let broadcastSuccess = false;
  let retryCount = 0;
  const maxRetries = 3;

  while (!broadcastSuccess && retryCount < maxRetries) {
    try {
      let theme = null;
      let items = null;
      try {
        theme = def.theme || null;
        items = Array.isArray(def.items) ? def.items.map(it => String(it.label || '')).filter(Boolean) : null;
      } catch { }

      const message = {
        type: 'roulette',
        token,
        name: def.name,
        username,
        value: picked.value ?? null,
        label: picked.label || null,
        createdAt: new Date().toISOString(),
        theme,
        items,
        instant: opts?.instant === true,
        batchId: opts?.batchId ? String(opts.batchId) : null,
        batchCount: Math.max(1, Number(opts?.batchCount ?? 1)),
        channelId: channelContext.channelId,
        channelVerified: true,
        serverInstance: process.env.INSTANCE_ID || 'unknown',
        broadcastAttempt: retryCount + 1
      };

      // Remember last batch meta for this token
      try {
        if (message.batchId) rouletteTokenLastBatch.set(token, { batchId: message.batchId, batchCount: message.batchCount });
      } catch { }

      const channelResult = await broadcastToChannel(channelContext.channelId, 'roulette', message, token);

      console.log(`[Roulette] Channel broadcast result for ${channelContext.channelId}: ${channelResult.success}/${channelResult.total} successful (token: ${token.substring(0, 8)}...)`);

      if (channelResult.success > 0) {
        broadcastSuccess = true;
        console.log(`[Roulette] Successfully broadcasted to ${channelResult.success} connections in channel: ${channelContext.channelId}`);
      } else if (channelResult.total === 0) {
        console.warn(`[Roulette] No active connections found in channel: ${channelContext.channelId} for token: ${token.substring(0, 8)}...`);

        try {
          await broadcastRouletteResult(token);
          broadcastSuccess = true;
          console.log(`[Roulette] Fallback broadcast completed for token: ${token.substring(0, 16)}...`);
        } catch (fallbackError) {
          console.error(`[Roulette] Fallback broadcast failed:`, fallbackError);
          broadcastSuccess = true;
        }
      } else if (channelResult.failed === channelResult.total) {
        console.warn(`[Roulette] All ${channelResult.total} connections failed in channel: ${channelContext.channelId}, trying fallback`);

        try {
          await broadcastRouletteResult(token);
          broadcastSuccess = true;
          console.log(`[Roulette] Fallback broadcast successful for token: ${token.substring(0, 16)}...`);
        } catch (fallbackError) {
          console.error(`[Roulette] Fallback broadcast failed:`, fallbackError);
        }
      } else {
        broadcastSuccess = true;
        console.log(`[Roulette] Partial broadcast success: ${channelResult.success}/${channelResult.total} connections in channel: ${channelContext.channelId}`);
      }
    } catch (e) {
      console.error(`[Roulette] Broadcast attempt ${retryCount + 1} failed for channel ${channelContext.channelId}:`, e);
      retryCount++;

      if (retryCount < maxRetries) {
        const delay = Math.min(100 * Math.pow(2, retryCount), 1000);
        console.log(`[Roulette] Retrying channel broadcast in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries}) for channel: ${channelContext.channelId}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`[Roulette] Max broadcast retries reached for channel: ${channelContext.channelId}, token: ${token.substring(0, 16)}..., error: ${e?.message || e}`);
      }
    }
  }

  if (!broadcastSuccess) {
    console.error(`[Roulette] Failed to broadcast after ${maxRetries} attempts for channel: ${channelContext.channelId}, token: ${token.substring(0, 16)}..., user: ${username}, roulette: ${def.name}`);

    try {
      const failureKey = `broadcast_failure:${channelContext.channelId}`;
    } catch (e) {
    }
  } else {
    console.log(`[Roulette] Broadcast completed successfully for channel: ${channelContext.channelId}, user: ${username}, result: ${picked.label}`);
  }
  const origin = (process.env.PUBLIC_ORIGIN || '');
  const path = `/roulette/${encodeURIComponent(token)}`;
  return { token, path, url: origin ? (origin.replace(/\/$/, '') + path) : path, result: picked };
}

/**
 */
async function executeRouletteResultCommand(sid, commandText, userId, username, chatPost = null) {
  try {
    console.log(`[Roulette Command] Executing: "${commandText}" for user: ${username} (${userId})`);

    const entry = sessionStore.get(sid);
    const chatPostProvider = String(chatPost?.provider || '').toLowerCase();
    const isCimeChatPost = chatPostProvider === 'cime';
    const isYoutubeChatPost = chatPostProvider === 'youtube';
    if (!isCimeChatPost && !isYoutubeChatPost && (!entry || !entry.sessionKey)) {
      console.error('[Roulette Command] No valid session found for sid:', sid);
      return;
    }

    const fakeMessage = {
      messageText: commandText,
      profile: {
        userId: userId,
        nickname: username
      },
      executionContext: {
        source: 'roulette',
        shouldDeductPoints: false,
        originalUser: { userId, username },
        rouletteExecution: true
      },
      messageTime: Date.now(),
      messageId: `roulette_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    };

    console.log(`[Roulette Command] Created fake message with context:`, {
      text: commandText,
      user: username,
      context: fakeMessage.executionContext
    });

    const settings = await getBotSettings(sid) || {};
    const rules = Array.isArray(settings.rules) ? settings.rules : [];
    const text = String(commandText || '').trim();
    const lower = text.toLowerCase();
    const now = Date.now();

    for (const r of rules) {
      if (!r || r.enabled === false) continue;

      const keywords = Array.isArray(r.keywords) ? r.keywords.filter(Boolean) : [];
      if (!keywords.length) continue;

      let matchedKeyword = null;
      const matched = keywords.some(kw => {
        if (!kw) return false;
        const ok = lower.startsWith(String(kw).toLowerCase());
        if (ok && matchedKeyword == null) matchedKeyword = String(kw);
        return ok;
      });

      if (!matched) continue;

      console.log(`[Roulette Command] Matched rule: ${r.name || 'unnamed'} with keyword: ${matchedKeyword}`, {
        ruleId: r.id,
        commandCost: Math.max(0, Number(r.pointsCost || 0)),
        pointsSkipped: true,
        executionSource: 'roulette'
      });

      const responses = Array.isArray(r.responses) ? r.responses.filter(Boolean) : [];
      let response = responses[Math.floor(Math.random() * responses.length)];

      let allowExecute = true;
      const commandCost = Math.max(0, Number(r.pointsCost || 0));

      console.log(`[Roulette Command] Command cost: ${commandCost}, skipping points check due to roulette context`);


      try {
        response = await substituteAllPlaceholders(response, sid, userId, username);
      } catch (e) {
        console.error('[Roulette Command] Placeholder substitution failed:', e);
      }

      const vdRe = /\$\{\s*video_donation\s*\}/i;
      const rlRe = /\$\{\s*roulette::([^}]+)\s*\}/i;

      let responseToSend = response;
      let ruleUsed = false;

      if (allowExecute && typeof response === 'string' && vdRe.test(response)) {
        console.log('[Roulette Command] Processing video donation trigger (no points deduction)');
        responseToSend = String(response).replace(/\$\{\s*video_donation\s*\}/ig, '').trim() || '룰렛 결과로 실행되었습니다. 포인트는 차감하지 않았습니다.';
      }

      if (typeof responseToSend === 'string' && rlRe.test(responseToSend)) {
        console.log('[Roulette Command] Processing nested roulette trigger');
        try {
          const m = String(responseToSend).match(rlRe);
          const name = m && m[1] ? String(m[1]).trim() : '';
          responseToSend = String(responseToSend).replace(/\$\{\s*roulette::([^}]+)\s*\}/ig, '').trim();

          if (name && allowExecute) {
            try {
              const accessToken = (isCimeChatPost || isYoutubeChatPost) ? null : await getValidAccessToken(sid);
              const base = {
                name,
                userId: String(userId || ''),
                username: String(username || ''),
                chatPost: isCimeChatPost
                  ? makeCimeChatPost(chatPost.ownerUserId, username, { suppressResultChat: false })
                  : isYoutubeChatPost
                    ? makeYoutubeChatPost(chatPost.ownerUserId, chatPost.liveChatId, username, { suppressResultChat: false })
                    : makeChzzkChatPost(entry.sessionKey, accessToken, username, { suppressResultChat: false })
              };

              console.log(`[Roulette Command] Enqueueing nested roulette: ${name}`);
              enqueueRouletteSpin(sid, { ...base, instant: false });

            } catch (e) {
              console.error('[Roulette Command] Nested roulette execution failed:', e);
              responseToSend = '중첩 룰렛 실행 중 오류가 발생했습니다.';
            }
          }
          ruleUsed = true;
        } catch (e) {
          console.error('[Roulette Command] Nested roulette processing failed:', e);
          responseToSend = '중첩 룰렛 처리 중 오류가 발생했습니다.';
        }
      }

      if (allowExecute) {
        try {
          const cmd = matchedKeyword || '';
          const rest = text.slice(cmd.length).trim();
          const args = rest.length ? rest.split(/\s+/).map(String) : [];

          let ownerPid = null;
          try {
            const owner = await getOwnerInfoForSid(sid);
            if (owner?.channelId) ownerPid = `user:${String(owner.channelId)}`;
          } catch { }
          if (!ownerPid && (isCimeChatPost || isYoutubeChatPost)) ownerPid = sid;

          if (ownerPid) {
            const payload = {
              type: 'command',
              cmd,
              args,
              from: { userId: userId, username: username },
              at: Date.now(),
              source: 'roulette',
              executionContext: {
                source: 'roulette',
                shouldDeductPoints: false,
                originalCommand: commandText,
                rouletteExecution: true
              }
            };

            try {
              emitWarudoEvent(ownerPid, payload);
              console.log(`[Roulette Command] Emitted WARUDO event with context:`, {
                cmd,
                args,
                source: payload.source,
                context: payload.executionContext
              });
            } catch (e) {
              console.error('[Roulette Command] WARUDO event emission failed:', e);
            }

            try {
              broadcastToDesktop(ownerPid, {
                ...payload,
                source: 'arubot-roulette',
                metadata: {
                  executedFromRoulette: true,
                  noPointsDeducted: true,
                  originalUser: { userId, username }
                }
              });
              console.log(`[Roulette Command] Desktop broadcast sent with roulette metadata`);
            } catch (e) {
              console.error('[Roulette Command] Desktop broadcast failed:', e);
            }
          }
        } catch (e) {
          console.error('[Roulette Command] Command event processing failed:', e);
        }
      }

      if (allowExecute && typeof responseToSend === 'string') {
        const actionResult = await executeAndStripActionVariableTokens(sid, responseToSend, {
          source: 'roulette-command',
          platform: chatPostProvider || 'chzzk',
          command: { keyword: matchedKeyword || '', text: commandText, ruleId: r.id || null, ruleName: r.name || null },
          user: { userId, username },
          chatPost: (isCimeChatPost || isYoutubeChatPost)
            ? chatPost
            : makeChzzkChatPost(entry?.sessionKey || null, null, username),
        });
        if (actionResult.used) {
          responseToSend = actionResult.text;
          ruleUsed = true;
        }
      }

      if (responseToSend && String(responseToSend).length > 0) {
        try {
          const finalMsg = '[룰렛 결과] ' + String(responseToSend);
          const post = (isCimeChatPost || isYoutubeChatPost) ? chatPost : makeChzzkChatPost(entry.sessionKey, await getValidAccessToken(sid), username);
          await sendChatByPost(sid, post, finalMsg, { timeout: 5000 });
          console.log('[Roulette Command] Response sent:', finalMsg);
        } catch (e) {
          console.error('[Roulette Command] Response send failed:', e?.response?.data || e?.message || e);
        }
      }

      if (ruleUsed || (responseToSend && String(responseToSend).length > 0)) {
        try {
          await upsertBotRule(sid, { ...r, lastUsed: now });
        } catch (e) {
          console.error('[Roulette Command] Rule update failed:', e);
        }
      }

      break;
    }

    console.log(`[Roulette Command] Command execution completed:`, {
      command: commandText,
      user: username,
      userId: userId,
      source: 'roulette',
      pointsDeducted: false,
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.error('[Roulette Command] Execution failed:', e);
    throw e;
  }
}

// (no change) keeping existing /api/video-donation/now-playing above

// Authenticated control API (admin panel) to sync pause/play/seek across viewers
app.post('/api/video-donation/control', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const q = getVideoQueue(sid);
    const op = String(req.body?.op || '').toLowerCase();
    if (op === 'volume') {
      const volume = normalizePvdVolume(req.body?.volume ?? req.body?.value ?? 100);
      const settings = await getBotSettings(sid) || {};
      await setBotSettings(sid, { ...settings, videoDonationVolume: volume });
      const message = await broadcastPvdControl(sid, { op, volume });
      return res.json({ ok: true, message });
    }
    if (!q[0]) return res.json({ ok: true });
    if (op === 'duration' || op === 'duration_sync') {
      const durationSec = Number(req.body?.durationSec ?? req.body?.duration ?? req.body?.value);
      const item = updateCurrentPvdDurationFromPlayer(sid, durationSec);
      if (!item) return res.status(400).json({ error: 'invalid duration' });
      return res.json({ ok: true, item });
    }
    let atSec = Number(req.body?.atSec);
    if (!Number.isFinite(atSec) || atSec < 0) atSec = getCurrentAtSec(sid);
    let state = pvdPlaybackState.get(sid);
    if (!state) { state = createPvdPlaybackState(q[0]); pvdPlaybackState.set(sid, state); }
    if (op === 'pause') {
      state.paused = true; state.pausedAtSec = Math.floor(atSec);
    } else if (op === 'play') {
      state.paused = false; setPvdPlaybackBaseFromAtSec(state, q[0], atSec); state.pausedAtSec = null;
    } else if (op === 'seek') {
      // keep paused state; only move time anchor
      if (state.paused) { state.pausedAtSec = Math.floor(atSec); }
      else { setPvdPlaybackBaseFromAtSec(state, q[0], atSec); }
    } else {
      return res.status(400).json({ error: 'invalid op' });
    }

    // Reschedule auto-pop based on the admin-controlled playback state.
    try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
    scheduleNextPvdAutoPop(sid);

    const message = await broadcastPvdControl(sid, { op, atSec: Math.floor(atSec), paused: state.paused === true });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'failed' });
  }
});

// Fetch live-detail once (no auth required) for a given uid and return normalized info
async function fetchLiveDetail(uid) {
  const r = await axiosGetWithRetry(`https://api.chzzk.naver.com/service/v2/channels/${encodeURIComponent(uid)}/live-detail`);
  const content = r?.data?.content || r?.data || {};
  const status = String(content?.status || '').toLowerCase();
  const live = isChzzkLiveDetailOpen(content);
  const title = content?.liveTitle || content?.title || '';
  const category = content?.liveCategory?.categoryType || content?.categoryType || content?.liveCategoryName || '';
  const viewers = Number(content?.concurrentUserCount || content?.currentViewerCount || 0);
  const openCandidate = content?.startedAt || content?.started_at || content?.openDate || content?.openTime || content?.openedAt || content?.liveStartAt || content?.startTime || content?.createdAt || null;
  const startedAtTs = parseChzzkLiveTimestamp(openCandidate, null);
  const startedAt = startedAtTs ? new Date(startedAtTs + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16) : '';
  const channel = content?.channel?.channelName || content?.channel?.name || '';
  return { status, title, category, viewers, startedAt, startedAtTs, channel, live, raw: content };
}

// (moved) getPartitionIdByApiKey defined below imports

async function getOwnerInfoForSid(sid) {
  const cached = ownerInfoCache.get(sid);
  const now = Date.now();
  if (cached && (now - cached.ts) < 10 * 60 * 1000) return cached; // 10m cache
  try {
    const accessToken = await getValidAccessToken(sid);
    const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const content = me?.data?.content || me?.data || {};
    const info = { ts: now, channelName: content?.channelName ? String(content.channelName) : undefined, channelId: content?.channelId ? String(content.channelId) : undefined };
    ownerInfoCache.set(sid, info);
    return info;
  } catch {
    return null;
  }
}

async function getLiveInfoForSid(sid) {
  const cached = liveInfoCache.get(sid);
  const now = Date.now();
  if (cached && (now - cached.ts) < 30 * 1000) return cached.info;
  const settings = await getBotSettings(sid) || {};
  let channelUids = await resolveChzzkChannelUidsForSid(sid, settings);

  if (!channelUids.length) {
    // Fallback: try to resolve via /open/v1/users/me (requires valid token)
    try {
      const accessToken = await getValidAccessToken(sid);
      const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const content = me?.data?.content || me?.data || {};
      if (content?.channelId) channelUids = [String(content.channelId)];
    } catch { }
  }
  if (!channelUids.length) {
    const cimeInfo = await fetchCimeLiveInfoForSid(sid);
    if (cimeInfo) liveInfoCache.set(sid, { ts: now, info: cimeInfo });
    if (cimeInfo) return cimeInfo;
    const youtubeInfo = await fetchYoutubeLiveInfoForSid(sid);
    if (youtubeInfo) liveInfoCache.set(sid, { ts: now, info: youtubeInfo });
    return youtubeInfo;
  }
  try {
    const info = await fetchLiveDetail(channelUids[0]);
    if (info?.live) {
      liveInfoCache.set(sid, { ts: now, info });
      return info;
    }
    const cimeInfo = await fetchCimeLiveInfoForSid(sid);
    if (cimeInfo?.live) {
      liveInfoCache.set(sid, { ts: now, info: cimeInfo });
      return cimeInfo;
    }
    const youtubeInfo = await fetchYoutubeLiveInfoForSid(sid);
    if (youtubeInfo?.live) {
      liveInfoCache.set(sid, { ts: now, info: youtubeInfo });
      return youtubeInfo;
    }
    liveInfoCache.set(sid, { ts: now, info });
    return info;
  } catch {
    const cimeInfo = await fetchCimeLiveInfoForSid(sid);
    if (cimeInfo) liveInfoCache.set(sid, { ts: now, info: cimeInfo });
    if (cimeInfo) return cimeInfo;
    const youtubeInfo = await fetchYoutubeLiveInfoForSid(sid);
    if (youtubeInfo) liveInfoCache.set(sid, { ts: now, info: youtubeInfo });
    return youtubeInfo;
  }
}

function looksLikeChzzkChannelId(value) {
  return /^[a-f0-9]{32}$/i.test(String(value || '').trim());
}

async function resolveChzzkChannelUidsForSid(sid, settings = null) {
  const ownerUserId = ownerUserIdFromSid(sid);
  const accountChannelId = await resolveChannelIdForOwnerUserId(ownerUserId, { provider: 'chzzk', allowFallback: false });
  if (looksLikeChzzkChannelId(accountChannelId)) return [accountChannelId];

  try {
    const accessToken = await getValidAccessToken(sid);
    const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const content = me?.data?.content || me?.data || {};
    if (looksLikeChzzkChannelId(content?.channelId)) return [String(content.channelId)];
  } catch { }

  const source = settings || await getBotSettings(sid) || {};
  const configured = Array.isArray(source.channelUids)
    ? source.channelUids.map(String).filter(Boolean)
    : (typeof source.channelUidsText === 'string'
      ? source.channelUidsText.split(',').map(s => s.trim()).filter(Boolean)
      : []);
  return configured.filter(looksLikeChzzkChannelId);
}

function formatElapsedStrings(startedAtTs) {
  const now = Date.now();
  let elapsed = '';
  let elapsedKo = '';
  if (startedAtTs) {
    const diffMs = now - Number(startedAtTs);
    if (diffMs > 0) {
      const totalSec = Math.floor(diffMs / 1000);
      const days = Math.floor(totalSec / 86400);
      const remAfterDays = totalSec % 86400;
      const hours = Math.floor(remAfterDays / 3600);
      const remAfterHours = remAfterDays % 3600;
      const minutes = Math.floor(remAfterHours / 60);
      const seconds = remAfterHours % 60;

      const hh = hours.toString().padStart(2, '0');
      const mm = minutes.toString().padStart(2, '0');
      const ss = seconds.toString().padStart(2, '0');
      // {live.elapsed}: include days only when >=24h
      elapsed = days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
      // {live.elapsed_ko}: natural Korean, omit zero units
      const koParts = [];
      if (days > 0) koParts.push(`${days}일`);
      if (hours > 0) koParts.push(`${hours}시간`);
      if (minutes > 0) koParts.push(`${minutes}분`);
      if (seconds > 0) koParts.push(`${seconds}초`);
      elapsedKo = koParts.length > 0 ? koParts.join(' ') : '0초';
    }
  }
  return { elapsed, elapsedKo };
}

async function substituteAllPlaceholders(text, sid, userId, username) {
  if (!text) return text;
  let out = String(text);
  if (/\{live\.(?:title|category|viewers|startedAt|elapsed|elapsed_ko|channel)\}/.test(out)) {
    const liveInfo = await getLiveInfoForSid(sid);
    if (liveInfo) {
      const { elapsed, elapsedKo } = formatElapsedStrings(liveInfo.startedAtTs);
      const notLiveMsg = '[방송 중이 아닙니다.]';
      out = out
        .replace(/\{live\.title\}/g, liveInfo.title || '')
        .replace(/\{live\.category\}/g, liveInfo.category || '')
        .replace(/\{live\.viewers\}/g, String(liveInfo.viewers ?? ''))
        .replace(/\{live\.startedAt\}/g, liveInfo.startedAt || '')
        .replace(/\{live\.elapsed\}/g, elapsed || notLiveMsg)
        .replace(/\{live\.elapsed_ko\}/g, elapsedKo || notLiveMsg)
        .replace(/\{live\.channel\}/g, liveInfo.channel || '');
    }
    else {
      // No live info: strip live placeholders to empty strings
      out = out
        .replace(/\{live\.title\}/g, '')
        .replace(/\{live\.category\}/g, '')
        .replace(/\{live\.viewers\}/g, '')
        .replace(/\{live\.startedAt\}/g, '')
        .replace(/\{live\.elapsed\}/g, '[방송 중이 아닙니다.]')
        .replace(/\{live\.elapsed_ko\}/g, '[방송 중이 아닙니다.]')
        .replace(/\{live\.channel\}/g, '');
    }
  }
  // Channel followers count
  if (/\{channel\.followers\}/.test(out)) {
    try {
      const count = await getChannelFollowersCountForSid(sid);
      out = out.replace(/\{channel\.followers\}/g, count != null ? String(count) : '');
    } catch { }
  }
  // User followedAt
  if (userId && /\{user\.followedAt\}/.test(out)) {
    try {
      const dt = await findUserFollowedAtForSid(sid, userId, username);
      out = out.replace(/\{user\.followedAt\}/g, dt || '확인할 수 없음');
    } catch {
      out = out.replace(/\{user\.followedAt\}/g, '확인할 수 없음');
    }
  }
  // User name placeholders
  if (username && (/{user\.name}/.test(out) || /{user\.username}/.test(out) || /{user\.nickname}/.test(out))) {
    out = out
      .replace(/\{user\.name\}/g, String(username))
      .replace(/\{user\.username\}/g, String(username))
      .replace(/\{user\.nickname\}/g, String(username));
  }
  if (userId && /\{user\.id\}/.test(out)) {
    out = out.replace(/\{user\.id\}/g, String(userId));
  }
  // User subscription months
  if (userId && /\{user\.subscriptionMonths\}/.test(out)) {
    try {
      const months = await getUserSubscriptionMonthsForSid(sid, userId);
      out = out.replace(/\{user\.subscriptionMonths\}/g, months != null ? String(months) : '');
    } catch { }
  }
  // User channel points
  if (userId && (/{user\.points}/.test(out) || /{user\.channelPoints}/.test(out))) {
    try {
      const channelUid = await resolveStreamerUidForSid(sid);
      if (channelUid) {
        const pts = await getChannelPoints(channelUid, userId);
        out = out.replace(/{user\.points}/g, String(pts)).replace(/{user\.channelPoints}/g, String(pts));
      } else {
        out = out.replace(/{user\.points}/g, '0').replace(/{user\.channelPoints}/g, '0');
      }
    } catch {
      out = out.replace(/{user\.points}/g, '0').replace(/{user\.channelPoints}/g, '0');
    }
  }
  // User total attendance days
  if (userId && /\{user\.attendanceDays\}/.test(out)) {
    try {
      const days = await getUserAttendanceTotalDays(sid, userId);
      out = out.replace(/\{user\.attendanceDays\}/g, days != null ? String(days) : '0');
    } catch {
      out = out.replace(/\{user\.attendanceDays\}/g, '0');
    }
  }
  // Days since follow (inclusive, follow day counts as 1)
  if (userId && /\{user\.followedDays\}/.test(out)) {
    try {
      const followedAt = await findUserFollowedAtForSid(sid, userId, username); // 'YYYY-MM-DD'
      if (followedAt) {
        const todayKst = getKstDateString(); // 'YYYY-MM-DD'
        const start = new Date(`${followedAt}T00:00:00Z`).getTime();
        const end = new Date(`${todayKst}T00:00:00Z`).getTime();
        const diffDays = Math.max(0, Math.floor((end - start) / (24 * 60 * 60 * 1000)));
        const inclusive = String(diffDays + 1);
        out = out.replace(/\{user\.followedDays\}/g, inclusive);
      } else {
        out = out.replace(/\{user\.followedDays\}/g, '0');
      }
    } catch {
      out = out.replace(/\{user\.followedDays\}/g, '0');
    }
  }
  return out;
}

// --- Channel followers and user relationship helpers (best-effort, cached) ---
const followersCountCache = new Map(); // sid -> { ts, count }
const userFollowedAtCache = new Map(); // key `${sid}:${userId}` -> { ts, date }
const userSubMonthsCache = new Map(); // key `${sid}:${userId}` -> { ts, months }

function addFollowerLookupCandidate(set, value) {
  const text = String(value || '').trim();
  if (!text) return;
  set.add(text);
  if (text.startsWith('user:')) set.add(text.slice(5));
  if (text.startsWith('cime:')) set.add(text.slice(5));
  if (text.startsWith('chzzk:')) set.add(text.slice(6));
  if (text.startsWith('youtube:')) set.add(text.slice(8));
  if (text.startsWith('cime:nickname:')) set.add(text.slice(14));
  if (text.startsWith('@')) set.add(text.slice(1));
}

function collectFollowerLookupCandidates(userId, username = '') {
  const set = new Set();
  addFollowerLookupCandidate(set, userId);
  addFollowerLookupCandidate(set, username);
  return set;
}

function collectFollowerItemIdentityCandidates(item = {}) {
  const set = new Set();
  const objects = [
    item,
    item.user,
    item.profile,
    item.channel,
    item.follower,
    item.followerChannel,
    item.followerProfile,
    item.sender,
  ].filter(Boolean);
  for (const source of objects) {
    [
      source.channelId,
      source.followerChannelId,
      source.userId,
      source.id,
      source.memberNo,
      source.accountId,
      source.platformUserId,
      source.nickname,
      source.nickName,
      source.name,
      source.channelName,
      source.displayName,
      source.handle,
      source.channelHandle,
    ].forEach((value) => addFollowerLookupCandidate(set, value));
  }
  return set;
}

function followerItemMatches(item, candidates) {
  if (!candidates?.size) return false;
  for (const value of collectFollowerItemIdentityCandidates(item)) {
    if (candidates.has(value)) return true;
  }
  return false;
}

function getFollowerItemDate(item = {}) {
  const objects = [item, item.user, item.profile, item.channel, item.follower, item.followerChannel, item.followerProfile].filter(Boolean);
  for (const source of objects) {
    const dt = source.createdDate || source.createdAt || source.followedAt || source.followDate || source.followedDate || source.timestamp || source.createdTime || source.followTime || null;
    if (dt) {
      const numeric = typeof dt === 'number' || /^\d+$/.test(String(dt)) ? Number(dt) : null;
      const parsed = numeric != null && Number.isFinite(numeric)
        ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
        : new Date(dt);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
      const text = String(dt || '').trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    }
  }
  return '';
}

function ownerUserIdFromSid(sid) {
  const text = String(sid || '').trim();
  return text.startsWith('user:') ? text.slice(5) : text;
}

function compactLogText(value, limit = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}

function makeCommandReplyKey(event = {}, rule = {}, matchedKeyword = '', text = '', userId = '') {
  const eventId = String(
    event?.messageId ||
    event?.msgId ||
    event?.eventId ||
    event?.id ||
    event?.chatId ||
    ''
  ).trim();
  const ruleKey = String(rule?.id || matchedKeyword || '').trim();
  if (eventId) return `${eventId}:${ruleKey}`;
  const eventTime = String(
    event?.messageTime ||
    event?.timestamp ||
    event?.msgTime ||
    event?.createdAt ||
    event?.time ||
    ''
  ).trim();
  const sender = String(userId || event?.senderChannelId || event?.userId || event?.user || event?.profile?.userId || '').trim();
  const textHash = crypto.createHash('sha1').update(String(text || event?.message || event?.content || '')).digest('hex').slice(0, 12);
  return `${sender || 'unknown'}|${eventTime || Date.now()}|${textHash}|${ruleKey}`;
}

function providerFromLogContext(context = {}) {
  return String(context.provider || context.platform || context.chatPost?.provider || 'chzzk').toLowerCase();
}

async function recordBotEventLogSafe(sid, event = {}) {
  try {
    const ownerUserId = event.ownerUserId || ownerUserIdFromSid(sid);
    if (!ownerUserId) return null;
    return await recordBotEventLog({
      ...event,
      ownerUserId,
      sid,
      summary: compactLogText(event.summary, 1000),
      metadata: event.metadata && typeof event.metadata === 'object' ? event.metadata : {},
    });
  } catch (error) {
    console.warn('[Bot Event Log] record skipped:', error?.message || error);
    return null;
  }
}

async function recordPredictionEventLogs(sid, prediction, context = {}) {
  const changes = Array.isArray(prediction?._eventLogs) ? prediction._eventLogs : [];
  if (!changes.length) return;
  const optionById = new Map((prediction?.options || []).map((option) => [String(option.id), option]));
  await Promise.all(changes.map((change) => {
    const option = optionById.get(String(change.optionId || '')) || null;
    const eventType = String(change.eventType || 'prediction_event');
    const label = option?.label || change.optionLabel || change.optionId || '';
    const actionLabel = eventType === 'prediction_bet'
      ? '예측 참여'
      : eventType === 'prediction_payout'
        ? '예측 정산 지급'
        : '예측 포인트 반환';
    return recordBotEventLogSafe(sid, {
      category: 'prediction',
      eventType,
      provider: context.provider || providerFromLogContext(context),
      channelUid: prediction?.channelUid || context.channelUid || null,
      viewerUserId: change.userId,
      viewerName: change.username,
      pointDelta: Number(change.pointDelta || 0),
      pointBefore: change.pointBefore ?? null,
      pointAfter: change.pointAfter ?? null,
      triggerName: prediction?.question || null,
      targetName: label,
      status: eventType === 'prediction_refund' ? 'refunded' : 'success',
      summary: `${actionLabel}: ${prediction?.question || '예측'}${label ? ` · ${label}` : ''}`,
      resultLabel: label || null,
      metadata: {
        predictionId: prediction?.id || null,
        optionId: change.optionId || null,
        amount: change.amount ?? null,
        payout: change.payout ?? null,
        status: prediction?.status || null,
      },
    });
  }));
}

async function recordCommandExecutionLog(sid, context = {}) {
  if (!context.executed) return;
  await recordBotEventLogSafe(sid, {
    category: context.category || 'command',
    eventType: context.eventType || 'command_execute',
    provider: providerFromLogContext(context),
    channelUid: context.channelUid || null,
    viewerUserId: context.userId || null,
    viewerName: context.username || null,
    pointDelta: Number(context.pointDelta || 0) || 0,
    pointBefore: context.pointBefore ?? null,
    pointAfter: context.pointAfter ?? null,
    triggerName: context.triggerName || null,
    targetName: context.targetName || null,
    status: context.status || 'success',
    summary: context.summary || `${context.triggerName || '명령어'} 실행${context.targetName ? ` · ${context.targetName}` : ''}`,
    resultLabel: context.resultLabel || null,
    resultValue: context.resultValue || null,
    metadata: {
      ruleId: context.ruleId || null,
      ruleName: context.ruleName || null,
      args: Array.isArray(context.args) ? context.args.slice(0, 10) : [],
      actionJobs: Array.isArray(context.actionJobs) ? context.actionJobs.map((job) => ({
        actionId: job.actionId || null,
        blueprintId: job.blueprintId || job.result?.run?.blueprintId || job.run?.blueprintId || null,
        runId: job.runId || job.result?.run?.id || job.run?.id || null,
        jobId: job.job?.id || job.jobId || null,
        kind: job.kind || null,
        ok: job.ok ?? null,
      })) : [],
      actionIds: Array.isArray(context.actionJobs)
        ? Array.from(new Set(context.actionJobs.map((job) => job.actionId || job.blueprintId || job.result?.run?.blueprintId || job.run?.blueprintId).filter(Boolean).map(String)))
        : [],
      features: context.features || [],
      source: context.source || null,
    },
  });
}

async function recordDonationRuleExecutionLog(sid, context = {}) {
  await recordBotEventLogSafe(sid, {
    category: 'donation',
    eventType: 'donation_rule_execute',
    provider: providerFromLogContext(context),
    channelUid: context.channelUid || null,
    viewerUserId: context.userId || null,
    viewerName: context.username || null,
    pointDelta: Number(context.pointDelta || 0) || 0,
    pointBefore: context.pointBefore ?? null,
    pointAfter: context.pointAfter ?? null,
    triggerName: context.ruleName || context.triggerName || null,
    targetName: context.targetName || null,
    summary: context.summary || `후원 반응 실행${context.ruleName ? ` · ${context.ruleName}` : ''}`,
    metadata: {
      ruleId: context.ruleId || null,
      ruleName: context.ruleName || null,
      amount: context.amount ?? null,
      message: compactLogText(context.message, 240),
      features: context.features || [],
      source: context.source || null,
    },
  });
}

function readFiniteNumber(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function parseLiveTimestamp(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1000000000000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isCimeLiveContentOpen(content) {
  if (!content || typeof content !== 'object') return false;
  if (content.live === true || content.isLive === true || content.openLive === true || content.isStreaming === true) return true;
  const rawStatus = String(content.status || content.liveStatus || content.state || content.broadcastStatus || content.streamStatus || '').trim().toLowerCase();
  if (!rawStatus) return false;
  if (['closed', 'close', 'offline', 'end', 'ended', 'stop', 'stopped', 'inactive', 'ready', 'standby', 'scheduled', 'not_open', 'not_live'].includes(rawStatus)) return false;
  if (rawStatus.includes('offline') || rawStatus.includes('ended') || rawStatus.includes('closed') || rawStatus.includes('not_')) return false;
  return ['open', 'live', 'onair', 'on_air', 'started', 'start', 'streaming', 'broadcasting'].includes(rawStatus)
    || rawStatus.includes('live')
    || rawStatus.includes('onair')
    || rawStatus.includes('open')
    || rawStatus.includes('start')
    || rawStatus.includes('stream');
}

async function getCimePlatformAccountForSid(sid) {
  const ownerUserId = ownerUserIdFromSid(sid);
  if (!ownerUserId) return null;
  try {
    const accounts = await listPlatformAccounts(ownerUserId);
    return (accounts || []).find((account) => String(account.provider || '').toLowerCase() === 'cime') || null;
  } catch {
    return null;
  }
}

async function fetchCimeLiveInfoForSid(sid) {
  const account = await getCimePlatformAccountForSid(sid);
  const channelId = account?.channel_id || account?.platform_user_id || null;
  if (!channelId) return null;
  try {
    const r = await axios.get(`${CIME_OPENAPI_BASE}/v1/${encodeURIComponent(channelId)}/live-status`, { timeout: DEFAULT_TIMEOUT });
    const content = unwrapOpenApiContent(r);
    const status = String(content?.status || content?.liveStatus || content?.state || '').toLowerCase();
    const live = isCimeLiveContentOpen(content);
    const title = content?.liveTitle || content?.title || content?.streamTitle || '';
    const category = content?.categoryName || content?.category || content?.liveCategoryName || '';
    const viewers = Number(content?.viewerCount || content?.currentViewerCount || content?.concurrentUserCount || 0);
    const startedCandidate = content?.startedAt || content?.started_at || content?.openDate || content?.openTime || content?.openedAt || content?.liveStartAt || content?.startTime || content?.createdAt || null;
    const cached = liveStatusCache.get(sid);
    const sessionStart = Number(liveSession.get(sid)?.sessionStartTime || 0) || null;
    const startedAtTs = parseLiveTimestamp(startedCandidate, live ? (cached?.provider === 'cime' ? cached.startTs : null) || sessionStart || Date.now() : null);
    const startedAt = startedAtTs && Number.isFinite(startedAtTs)
      ? new Date(startedAtTs + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16)
      : '';
    const channel = content?.channelName || account?.channel_name || account?.channel_handle || '';
    return { status, title, category, viewers, startedAt, startedAtTs, channel, live, raw: content, provider: 'cime' };
  } catch {
    const cached = liveStatusCache.get(sid);
    if (cached?.provider === 'cime' && cached.live === true && Date.now() - Number(cached.ts || 0) < 2 * 60 * 1000) {
      const startedAtTs = Number(cached.startTs || liveSession.get(sid)?.sessionStartTime || Date.now());
      const startedAt = Number.isFinite(startedAtTs)
        ? new Date(startedAtTs + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16)
        : '';
      return {
        status: 'live',
        title: '',
        category: '',
        viewers: 0,
        startedAt,
        startedAtTs,
        channel: account?.channel_name || account?.channel_handle || '',
        live: true,
        raw: { source: 'recent_cime_event' },
        provider: 'cime'
      };
    }
    return null;
  }
}

async function getYoutubePlatformAccountForSid(sid) {
  const ownerUserId = ownerUserIdFromSid(sid);
  if (!ownerUserId) return null;
  try {
    const accounts = await listPlatformAccounts(ownerUserId);
    return (accounts || []).find((account) => String(account.provider || '').toLowerCase() === 'youtube') || null;
  } catch {
    return null;
  }
}

async function fetchYoutubeLiveInfoForSid(sid) {
  const ownerUserId = ownerUserIdFromSid(sid);
  const account = await getYoutubePlatformAccountForSid(sid);
  if (!ownerUserId || !account) return null;
  try {
    const info = await fetchYoutubeActiveLive(ownerUserId);
    if (!info) return null;
    return {
      status: info.status || '',
      title: info.title || '',
      category: info.category || '',
      viewers: info.viewers,
      startedAt: info.startedAt || '',
      startedAtTs: info.startedAtTs || null,
      channel: info.channel || account.channel_name || account.channel_handle || '',
      live: !!info.live,
      raw: info.raw || {},
      provider: 'youtube'
    };
  } catch {
    return null;
  }
}

async function getChannelUidsForSid(sid) {
  const settings = await getBotSettings(sid) || {};
  return resolveChzzkChannelUidsForSid(sid, settings);
}

async function getChannelFollowersCountForSid(sid) {
  const cached = followersCountCache.get(sid);
  const now = Date.now();
  if (cached && (now - cached.ts) < 5 * 60 * 1000) return cached.count;
  const uids = await getChannelUidsForSid(sid);
  if (!uids.length) return null;
  const channelId = uids[0];
  let count = null;
  try {
    // Try open API first
    const accessToken = await getValidAccessToken(sid);
    const r1 = await axios.get(`${OPENAPI_BASE}/open/v1/channels/${encodeURIComponent(channelId)}/followers/count`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    count = Number(r1?.data?.content?.totalCount ?? r1?.data?.totalCount ?? r1?.data?.count ?? NaN);
  } catch { }
  if (count == null || Number.isNaN(count)) {
    try {
      // Fallback to service API if available
      const r2 = await axios.get(`https://api.chzzk.naver.com/service/v1/channels/${encodeURIComponent(channelId)}/followers/count`);
      count = Number(r2?.data?.content?.totalCount ?? r2?.data?.totalCount ?? r2?.data?.count ?? NaN);
    } catch { }
  }
  if (count != null && !Number.isNaN(count)) {
    followersCountCache.set(sid, { ts: now, count });
    return count;
  }
  try {
    const cimeAccount = await getCimePlatformAccountForSid(sid);
    const publicProfile = cimeAccount?.metadata?.publicProfile || {};
    const cimeCount = readFiniteNumber(publicProfile.followerCount, publicProfile.raw?.followerCount, publicProfile.raw?.followers, publicProfile.raw?.followCount);
    if (cimeCount != null) {
      followersCountCache.set(sid, { ts: now, count: cimeCount });
      return cimeCount;
    }
  } catch { }
  return null;
}

// (moved) API Key management endpoints are registered after app initialization

async function findUserFollowedAtForSid(sid, userId, username = '') {
  if (!userId) return null;
  const key = `${sid}:${userId}:${username}`;
  const cached = userFollowedAtCache.get(key);
  const now = Date.now();
  if (cached && (now - cached.ts) < 10 * 60 * 1000) return cached.date;
  const matchCandidates = collectFollowerLookupCandidates(userId, username);
  const maxChzzkPages = Math.max(1, Math.min(10000, Number(process.env.CHZZK_FOLLOWER_SCAN_PAGES || process.env.FOLLOWER_SCAN_PAGES || 10000)));
  const maxCimePages = Math.max(1, Math.min(1000, Number(process.env.CIME_FOLLOWER_SCAN_PAGES || process.env.FOLLOWER_SCAN_PAGES || 1000)));
  const lookupTimeout = Math.max(500, Math.min(30000, Number(process.env.FOLLOWER_LOOKUP_HTTP_TIMEOUT_MS || DEFAULT_TIMEOUT)));
  const uids = await getChannelUidsForSid(sid);
  if (uids.length) {
    const channelId = uids[0];
    try {
      const accessToken = await getValidAccessToken(sid);
      // Best-effort: paginate followers list to find the user
      const size = 50;
      for (let page = 1; page <= maxChzzkPages; page++) {
        let data;
        try {
          const r = await axios.get(`${OPENAPI_BASE}/open/v1/channels/followers`, {
            params: { page, size },
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: lookupTimeout,
          });
          data = r?.data?.content || r?.data || {};
        } catch {
          // Fallback to service API
          const r2 = await axios.get(`https://api.chzzk.naver.com/service/v1/channels/${encodeURIComponent(channelId)}/followers`, {
            params: { page, size },
            timeout: lookupTimeout,
          });
          data = r2?.data?.content || r2?.data || {};
        }
        const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.followers) ? data.followers : []);
        if (!Array.isArray(list) || list.length === 0) break;
        for (const item of list) {
          if (followerItemMatches(item, matchCandidates)) {
            const iso = getFollowerItemDate(item);
            userFollowedAtCache.set(key, { ts: now, date: iso });
            return iso;
          }
        }
        if (list.length < size) break;
      }
    } catch (e) { console.error(e) }
  }
  try {
    const ownerUserId = ownerUserIdFromSid(sid);
    if (ownerUserId) {
      const accessToken = await getValidCimeAccessToken(ownerUserId);
      const size = 100;
      for (let page = 0; page < maxCimePages; page++) {
        const r = await axios.get(`${CIME_OPENAPI_BASE}/open/v1/channels/followers`, {
          params: { page, size },
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: lookupTimeout,
        });
        const content = unwrapOpenApiContent(r);
        const list = Array.isArray(content?.data) ? content.data : (Array.isArray(content) ? content : []);
        if (!list.length) break;
        for (const item of list) {
          if (followerItemMatches(item, matchCandidates)) {
            const iso = getFollowerItemDate(item);
            userFollowedAtCache.set(key, { ts: now, date: iso });
            return iso;
          }
        }
        if (list.length < size) break;
      }
    }
  } catch (e) {
    const status = Number(e?.response?.status || 0);
    if (status === 401 || status === 403) {
      console.warn('[CIME] Follower lookup requires READ:CHANNEL scope. Reconnect the CIME account to refresh OAuth permissions.');
      return null;
    }
  }
  userFollowedAtCache.set(key, { ts: now, date: '' });
  return null;
}

async function getUserSubscriptionMonthsForSid(sid, userId) {
  if (!userId) return null;
  const key = `${sid}:${userId}`;
  const cached = userSubMonthsCache.get(key);
  const now = Date.now();
  if (cached && (now - cached.ts) < 10 * 60 * 1000) return cached.months;
  const uids = await getChannelUidsForSid(sid);
  if (!uids.length) {
    const cimeCached = userSubMonthsCache.get(key);
    if (cimeCached && (now - cimeCached.ts) < 24 * 60 * 60 * 1000) return cimeCached.months;
    return null;
  }
  const channelId = uids[0];
  try {
    const accessToken = await getValidAccessToken(sid);
    // Try open subscriptions API
    const size = 100;
    for (let page = 1; page <= 50; page++) {
      let data;
      try {
        const r = await axios.get(`${OPENAPI_BASE}/open/v1/channels/${encodeURIComponent(channelId)}/subscriptions`, {
          params: { page, size },
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        data = r?.data?.content || r?.data || {};
      } catch {
        // Fallback service API
        const r2 = await axios.get(`https://api.chzzk.naver.com/service/v1/channels/${encodeURIComponent(channelId)}/subscriptions`, {
          params: { page, size },
        });
        data = r2?.data?.content || r2?.data || {};
      }
      const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.subscriptions) ? data.subscriptions : []);
      if (!Array.isArray(list) || list.length === 0) break;
      for (const item of list) {
        const uid = String(item?.userId || item?.subscriberId || item?.user?.userId || '');
        if (uid && uid === String(userId)) {
          const months = Number(item?.totalMonth || item?.months || item?.subscriptionMonths || 0);
          userSubMonthsCache.set(key, { ts: now, months });
          return months;
        }
      }
      if (list.length < size) break;
    }
  } catch { }
  const cimeCached = userSubMonthsCache.get(key);
  if (cimeCached && (now - cimeCached.ts) < 24 * 60 * 60 * 1000) return cimeCached.months;
  return null;
}

// HTTP helper (keep-alive + retry) for CHZZK service API
const httpsAgent = new https.Agent({ keepAlive: true });
const PREFER_IPV4 = String(process.env.PREFER_IPV4 || '').toLowerCase() === 'true';
const DEFAULT_TIMEOUT = Number(process.env.CHZZK_HTTP_TIMEOUT_MS || 8000);
const DEFAULT_RETRIES = Number(process.env.CHZZK_HTTP_RETRIES || 2);
const DEFAULT_BACKOFF = Number(process.env.CHZZK_HTTP_RETRY_BACKOFF_MS || 300);
const customLookup = PREFER_IPV4
  ? (hostname, options, callback) => {
    // Try IPv4 first, fallback to default
    if (typeof options === 'function') { callback = options; options = {}; }
    dns.lookup(hostname, { family: 4, all: false }, (err, address, family) => {
      if (!err && address) return callback(null, address, family);
      dns.lookup(hostname, options, callback);
    });
  }
  : undefined;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function axiosGetWithRetry(url, opts = {}, retries = DEFAULT_RETRIES) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.get(url, {
        httpsAgent,
        timeout: DEFAULT_TIMEOUT,
        lookup: customLookup,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AruBot/1.0)',
          Accept: 'application/json, text/plain, */*',
        },
        ...opts,
      });
    } catch (e) {
      lastErr = e;
      const code = (e && e.code) || (e && e.cause && e.cause.code) || '';
      const retriable = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(String(code));
      if (i < retries && retriable) {
        await sleep(DEFAULT_BACKOFF * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
// Global process-level error handlers to prevent crashes on unhandled promise rejections
try {
  process.on('unhandledRejection', (reason) => {
    console.error('[UnhandledRejection]', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[UncaughtException]', err);
  });
} catch { }
// Defer socket.io-client import until runtime and ensure Node's undici WebSocket is not used
async function getIoClient() {
  try {
    // Unset global WebSocket so engine.io-client falls back to its Node ws implementation
    // This avoids undici WebSocket recursion on Node 22+
    // @ts-ignore
    if (globalThis.WebSocket) delete globalThis.WebSocket;
  } catch { }
  const mod = await import('socket.io-client');
  return mod.default || mod;
}

// Utility: get KST date (YYYY-MM-DD)
function getKstDateString(ts = Date.now()) {
  const kst = new Date(ts + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 *
 */
async function updateSessionState(sid, isLive, startTimestamp) {
  const now = Date.now();
  const startTime = Date.now();

  let currentSession;
  let dbLookupSuccess = true;
  try {
    currentSession = await getLiveSessionFromDB(sid);
    logDBOperation('get', 'live_sessions', sid, true, Date.now() - startTime, null, { operation: 'session_lookup' });
  } catch (error) {
    dbLookupSuccess = false;
    logDBOperation('get', 'live_sessions', sid, false, Date.now() - startTime, error, { operation: 'session_lookup' });
    currentSession = liveSession.get(sid);
  }

  const oldState = currentSession || liveSession.get(sid);

  if (isLive) {
    if (!currentSession?.live || !currentSession?.start_date) {
      const startDateKst = getKstDateString(startTimestamp);
      const newSession = {
        sid,
        live: true,
        start_date: startDateKst,
        session_start_time: startTimestamp || now,
        last_update: now
      };

      const dbStartTime = Date.now();
      try {
        // DB ?낅뜲?댄듃
        await upsertLiveSessionToDB(newSession);
        logDBOperation('upsert', 'live_sessions', sid, true, Date.now() - dbStartTime, null, {
          operation: 'start_session',
          startDate: startDateKst
        });
      } catch (error) {
        logDBOperation('upsert', 'live_sessions', sid, false, Date.now() - dbStartTime, error, {
          operation: 'start_session',
          startDate: startDateKst
        });
      }

      const newCacheState = {
        live: true,
        startDate: startDateKst,
        sessionStartTime: startTimestamp || now,
        lastUpdate: now
      };
      memoryManager.addSessionWithSizeCheck(sid, newCacheState);

      logSessionStateChange(sid, oldState, newCacheState, dbLookupSuccess ? 'db' : 'cache', {
        operation: 'start_session',
        startTimestamp: startTimestamp || now
      });

      try {
        await markLiveDay(sid, startDateKst);
      } catch (error) {
        console.warn(`[Session] Failed to mark live day for ${sid}:`, error);
      }
    } else {
      const updateStartTime = Date.now();
      try {
        await updateLiveSessionLastUpdate(sid, now);
        logDBOperation('update', 'live_sessions', sid, true, Date.now() - updateStartTime, null, {
          operation: 'update_last_update'
        });
      } catch (error) {
        logDBOperation('update', 'live_sessions', sid, false, Date.now() - updateStartTime, error, {
          operation: 'update_last_update'
        });
      }

      if (liveSession.has(sid)) {
        const cached = liveSession.get(sid);
        const oldCacheState = { ...cached };
        cached.lastUpdate = now;

        logSessionStateChange(sid, oldCacheState, cached, 'cache', {
          operation: 'update_last_update'
        });
      }
    }
  } else {
    const endSession = {
      sid,
      live: false,
      start_date: null,
      session_start_time: null,
      last_update: now
    };

    const dbEndTime = Date.now();
    try {
      // DB ?낅뜲?댄듃
      await upsertLiveSessionToDB(endSession);
      logDBOperation('upsert', 'live_sessions', sid, true, Date.now() - dbEndTime, null, {
        operation: 'end_session'
      });
    } catch (error) {
      logDBOperation('upsert', 'live_sessions', sid, false, Date.now() - dbEndTime, error, {
        operation: 'end_session'
      });
    }

    const newCacheState = {
      live: false,
      startDate: undefined,
      sessionStartTime: undefined,
      lastUpdate: now
    };
    memoryManager.addSessionWithSizeCheck(sid, newCacheState);

    logSessionStateChange(sid, oldState, newCacheState, dbLookupSuccess ? 'db' : 'cache', {
      operation: 'end_session'
    });
  }
}

/**
 *
 */
async function getAttendanceDate(sid) {
  const startTime = Date.now();

  try {
    const cachedSession = liveSession.get(sid);
    if (cachedSession?.live && cachedSession?.startDate) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(cachedSession.startDate)) {
        logPerformanceMetrics('getAttendanceDate', sid, {
          duration: Date.now() - startTime,
          source: 'memory',
          cacheHit: true
        });
        return cachedSession.startDate;
      }
    }

    //
    const dbStartTime = Date.now();
    try {
      const dbSession = await getLiveSessionFromDB(sid);
      logDBOperation('get', 'live_sessions', sid, true, Date.now() - dbStartTime, null, {
        operation: 'attendance_date_lookup'
      });

      if (dbSession?.live && dbSession?.start_date) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dbSession.start_date)) {
          if (cachedSession && (
            cachedSession.live !== dbSession.live ||
            cachedSession.startDate !== dbSession.start_date
          )) {
            logCacheDBMismatch(sid, 'session_state', cachedSession, {
              live: dbSession.live,
              startDate: dbSession.start_date
            }, 'sync_from_db');
          }

          liveSession.set(sid, {
            live: dbSession.live,
            startDate: dbSession.start_date,
            sessionStartTime: dbSession.session_start_time,
            lastUpdate: dbSession.last_update
          });

          logPerformanceMetrics('getAttendanceDate', sid, {
            duration: Date.now() - startTime,
            source: 'database',
            cacheHit: false,
            dbQueryTime: Date.now() - dbStartTime
          });

          return dbSession.start_date;
        }
      }
    } catch (dbError) {
      logDBOperation('get', 'live_sessions', sid, false, Date.now() - dbStartTime, dbError, {
        operation: 'attendance_date_lookup'
      });
    }

    const fallbackDate = getKstDateString();
    logPerformanceMetrics('getAttendanceDate', sid, {
      duration: Date.now() - startTime,
      source: 'current_kst',
      cacheHit: false,
      fallback: true
    });

    return fallbackDate;
  } catch (error) {
    console.error(`[Attendance] All fallbacks failed for ${sid}:`, error);
    const fallbackDate = getKstDateString();

    logPerformanceMetrics('getAttendanceDate', sid, {
      duration: Date.now() - startTime,
      source: 'emergency',
      cacheHit: false,
      fallback: true,
      error: error.message
    });

    return fallbackDate;
  }
}

/**
 *
 */
async function validateAndRecoverSessionState(sid) {
  const startTime = Date.now();

  try {
    const dbStartTime = Date.now();
    const dbSession = await getLiveSessionFromDB(sid);
    logDBOperation('get', 'live_sessions', sid, true, Date.now() - dbStartTime, null, {
      operation: 'session_validation'
    });

    const cachedSession = liveSession.get(sid);
    const liveStatus = liveStatusCache.get(sid);

    if (dbSession && cachedSession) {
      const hasLiveMismatch = dbSession.live !== cachedSession.live;
      const hasDateMismatch = (dbSession.start_date || null) !== (cachedSession.startDate || null);

      if (hasLiveMismatch || hasDateMismatch) {
        logCacheDBMismatch(sid, 'session_state', {
          live: cachedSession.live,
          startDate: cachedSession.startDate,
          lastUpdate: cachedSession.lastUpdate
        }, {
          live: dbSession.live,
          start_date: dbSession.start_date,
          last_update: dbSession.last_update
        }, 'sync_from_db');

        const oldCacheState = { ...cachedSession };

        const newCacheState = {
          live: dbSession.live,
          startDate: dbSession.start_date || undefined,
          sessionStartTime: dbSession.session_start_time,
          lastUpdate: dbSession.last_update
        };
        liveSession.set(sid, newCacheState);

        logSessionStateChange(sid, oldCacheState, newCacheState, 'db', {
          operation: 'cache_sync_from_db',
          mismatchTypes: {
            live: hasLiveMismatch,
            date: hasDateMismatch
          }
        });
      }
    }

    const liveStatusLive = liveStatus?.live || false;
    const sessionLive = dbSession?.live || false;
    const hasSessionDate = !!(dbSession?.start_date);

    if (liveStatusLive && (!sessionLive || !hasSessionDate)) {
      logCacheDBMismatch(sid, 'live_status', {
        liveStatus: liveStatusLive
      }, {
        sessionLive: sessionLive,
        hasSessionDate: hasSessionDate
      }, 'recover_session');

      console.warn(`[Session] Live status mismatch for ${sid}, recovering session...`);
      await updateSessionState(sid, true, Date.now());

    } else if (!liveStatusLive && sessionLive) {
      logCacheDBMismatch(sid, 'live_status', {
        liveStatus: liveStatusLive
      }, {
        sessionLive: sessionLive
      }, 'end_session');

      console.warn(`[Session] Session shows live but status cache shows offline for ${sid}, ending session...`);
      await updateSessionState(sid, false);
    }

    logPerformanceMetrics('validateAndRecoverSessionState', sid, {
      duration: Date.now() - startTime,
      dbQueryTime: Date.now() - dbStartTime,
      hasDbSession: !!dbSession,
      hasCachedSession: !!cachedSession,
      hasLiveStatus: !!liveStatus
    });

  } catch (error) {
    logDBOperation('get', 'live_sessions', sid, false, Date.now() - startTime, error, {
      operation: 'session_validation'
    });
    console.error(`[Session] Validation failed for ${sid}:`, error);
  }
}

// --- Live status & info cache per sid ---
// { [sid]: { ts: number, live: boolean } }
const liveStatusCache = new Map();
// Track current live session state to know the start date (KST) when broadcast began
// liveSession: { [sid]: { live: boolean, startDate?: string } }
// Note: liveSession is now declared later with enhanced memory management
// Live info cache: { [sid]: { ts, info } }
const liveInfoCache = new Map();
// Owner/user cache: { [sid]: { ts, userId, channelId } }
const ownerInfoCache = new Map();
// Attendance dedupe cache for current process: key `${sid}:${userId}:${date}` -> true
const attendanceDedupe = new Set();
const DEFAULT_ATTENDANCE_MESSAGE = '{user.name}님 출석체크 완료! (연속 {attendance.streak}일, 누적 {attendance.totalDays}일)';

function renderAttendanceMessage(template, context = {}) {
  const source = String(template || DEFAULT_ATTENDANCE_MESSAGE).trim() || DEFAULT_ATTENDANCE_MESSAGE;
  const replacements = {
    '{user.name}': context.username || '',
    '{user.id}': context.userId || '',
    '{attendance.streak}': context.streak ?? 0,
    '{attendance.totalDays}': context.totalDays ?? 0,
    '{attendance.points}': context.points ?? 0,
    '{attendance.date}': context.date || ''
  };
  return Object.entries(replacements).reduce(
    (message, [token, value]) => message.split(token).join(String(value)),
    source
  ).slice(0, 100);
}
// Track active sids seen by the server to enable background live checks
const liveChatEnsurePromises = new Map(); // sid:channelId -> Promise
const CHZZK_LIVE_STATUS_TTL_MS = Math.max(5000, Number(process.env.CHZZK_LIVE_STATUS_TTL_MS || 15000));
const LIVE_STATUS_POLL_INTERVAL_MS = Math.max(5000, Number(process.env.LIVE_STATUS_POLL_INTERVAL_MS || 15000));
const CHZZK_CHAT_CONNECT_ON_LIVE = String(process.env.CHZZK_CHAT_CONNECT_ON_LIVE || 'true').toLowerCase() !== 'false';

function parseChzzkLiveTimestamp(value, fallback = Date.now()) {
  if (value == null || value === '') return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1000000000000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isChzzkLiveDetailOpen(content) {
  const status = String(content?.status || content?.liveStatus || content?.state || '').toLowerCase();
  return status === 'open' || status === 'live' || status === 'onair' || status === 'on_air' || content?.openLive === true || content?.isLive === true || content?.live === true;
}

async function ensureChzzkChatSessionForLiveSid(sid, channelId = null) {
  if (!CHZZK_CHAT_CONNECT_ON_LIVE || !sid) return null;
  let targetChannelId = channelId ? String(channelId) : '';
  if (!targetChannelId) {
    try {
      const settings = await getBotSettings(sid) || {};
      const uids = await resolveChzzkChannelUidsForSid(sid, settings);
      targetChannelId = uids[0] || '';
    } catch { }
  }
  if (!targetChannelId) return null;

  const existing = sessionStore.get(sid);
  if (existing?.connected && existing?.subscribed?.has?.(targetChannelId)) return existing;

  const key = `${sid}:${targetChannelId}`;
  if (liveChatEnsurePromises.has(key)) return liveChatEnsurePromises.get(key);

  const promise = ensureSession(sid, targetChannelId)
    .then((entry) => {
      console.log(`[CHZZK] Live chat session ensured for ${sid} channel=${targetChannelId}`);
      return entry;
    })
    .catch((error) => {
      console.warn(`[CHZZK] Failed to ensure live chat session for ${sid} channel=${targetChannelId}:`, error?.response?.data || error?.message || error);
      return null;
    })
    .finally(() => {
      liveChatEnsurePromises.delete(key);
    });

  liveChatEnsurePromises.set(key, promise);
  return promise;
}

function closeChzzkChatSessionForOfflineSid(sid, channelId = null, reason = 'live_offline') {
  let entry = sid ? sessionStore.get(sid) : null;
  const targetChannelId = channelId ? String(channelId) : String(entry?.channelId || '');
  if (!entry && targetChannelId) entry = channelSessionStore.get(targetChannelId);
  if (!entry) return false;

  const sids = entry.sids instanceof Set && entry.sids.size
    ? Array.from(entry.sids)
    : Array.from(sessionStore.entries()).filter(([, value]) => value === entry).map(([key]) => key);

  for (const mappedSid of sids) {
    sessionStore.delete(mappedSid);
  }
  if (targetChannelId && channelSessionStore.get(targetChannelId) === entry) {
    channelSessionStore.delete(targetChannelId);
  }

  entry.connected = false;
  try { entry.subscribed?.clear?.(); } catch { }
  try { entry.sids?.clear?.(); } catch { }
  try {
    if (entry.socket && (entry.socket.connected || typeof entry.socket.disconnect === 'function')) {
      entry.socket.disconnect();
    }
  } catch { }

  console.log(`[CHZZK] Chat session closed for offline broadcast sid=${sid || 'unknown'} channel=${targetChannelId || 'unknown'} reason=${reason}`);
  return true;
}

async function refreshChzzkLiveStatusForSid(sid, options = {}) {
  if (!sid) return { live: false, channelId: null, startTs: null };
  const now = Date.now();
  const ttlMs = Number.isFinite(Number(options.ttlMs)) ? Number(options.ttlMs) : CHZZK_LIVE_STATUS_TTL_MS;
  const cached = liveStatusCache.get(sid);
  if (!options.force && cached?.provider === 'chzzk' && (now - cached.ts) < ttlMs) {
    if (cached.live && options.ensureChat !== false) {
      ensureChzzkChatSessionForLiveSid(sid, cached.channelId).catch(() => { });
    }
    return { live: !!cached.live, channelId: cached.channelId || null, startTs: cached.startTs || null, cached: true };
  }

  const settings = options.settings || await getBotSettings(sid) || {};
  const channelUids = Array.isArray(options.channelUids) ? options.channelUids : await resolveChzzkChannelUidsForSid(sid, settings);
  if (!channelUids.length) {
    liveStatusCache.set(sid, { ts: now, live: false, provider: 'chzzk', channelId: null, startTs: null });
    return { live: false, channelId: null, startTs: null };
  }

  let anyLive = false;
  let liveChannelId = null;
  let startTs = null;
  for (const uid of channelUids) {
    try {
      const r = await axiosGetWithRetry(`https://api.chzzk.naver.com/service/v2/channels/${encodeURIComponent(uid)}/live-detail`);
      const content = r?.data?.content || r?.data || {};
      if (isChzzkLiveDetailOpen(content)) {
        anyLive = true;
        liveChannelId = String(uid);
        const candidate = content?.startedAt || content?.started_at || content?.openDate || content?.openTime || content?.openedAt || content?.liveStartAt || content?.startTime || content?.createdAt || null;
        startTs = parseChzzkLiveTimestamp(candidate, now);
        break;
      }
    } catch (e) {
      console.warn('[live-detail] fetch failed for', uid, e?.code || e?.message || e);
    }
  }

  const previousLive = cached?.provider === 'chzzk' ? !!cached.live : undefined;
  const cachedSession = liveSession.get(sid);
  const sessionLastUpdate = Number(cachedSession?.lastUpdate || 0);

  liveStatusCache.set(sid, {
    ts: now,
    live: anyLive,
    provider: 'chzzk',
    channelId: liveChannelId,
    startTs: startTs || null
  });

  const shouldPersistSessionState = anyLive
    ? previousLive !== true || !cachedSession?.live || (now - sessionLastUpdate) > 60 * 1000
    : previousLive === true || !!cachedSession?.live;

  if (shouldPersistSessionState) {
    try {
      await updateSessionState(sid, anyLive, startTs || now);
    } catch (error) {
      console.error(`[Session] Failed to update CHZZK live session state for ${sid}:`, error?.message || error);
    }
  }

  if (anyLive && options.ensureChat !== false) {
    ensureChzzkChatSessionForLiveSid(sid, liveChannelId).catch(() => { });
  } else if (!anyLive && options.closeChat !== false) {
    closeChzzkChatSessionForOfflineSid(sid, channelUids[0] || liveChannelId, 'live_status_offline');
  }

  return { live: anyLive, channelId: liveChannelId, startTs: startTs || null };
}

async function isLiveAllowedForSid(sid) {
  try {
    const settings = await getBotSettings(sid) || {};
    const onlyWhenLive = !!settings.onlyWhenLive;
    const channelUids = await resolveChzzkChannelUidsForSid(sid, settings);

    if (!channelUids.length) return !onlyWhenLive; // unrestricted mode can still process without a live channel

    const state = await refreshChzzkLiveStatusForSid(sid, { settings, channelUids });
    return !onlyWhenLive || !!state.live;
  } catch {
    return true;
  }
}

// Optional Redis (for multi-instance fan-out)
let redisEnabled = false;
let redisPkg = null;
let redisPublisher = null;
const redisSubscribers = new Map(); // pid -> subscriber client
const REDIS_URL = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || '';
async function initRedis() {
  if (!REDIS_URL) return;
  try {
    // dynamic import to avoid hard dependency when not installed
    const mod = await import('redis');
    redisPkg = mod;
    redisPublisher = mod.createClient({ url: REDIS_URL });
    redisPublisher.on('error', (e) => console.warn('[Redis] publisher error', e?.message || e));
    await redisPublisher.connect();
    redisEnabled = true;
  } catch (e) {
    console.warn('[Redis] Disabled (install redis pkg and set REDIS_URL).', e?.message || e);
  }
}

// Resolve pid from API key if present in headers
async function getPartitionIdByApiKey(req) {
  try {
    const auth = req.headers['authorization'];
    let key = req.headers['x-api-key'];
    if (!key && typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
      key = auth.slice(7).trim();
    }
    if (!key) return null;
    const pid = await getOwnerPidForApiKey(String(key));
    if (pid) {
      try { await touchApiKeyLastUsed(String(key)); } catch { }
      return pid;
    }
    return null;
  } catch { return null; }
}

// Config
const CHZZK_CLIENT_ID = process.env.CHZZK_CLIENT_ID;
const CHZZK_CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET;
const CHZZK_REDIRECT_URI = process.env.CHZZK_REDIRECT_URI || `http://localhost:${PORT}/api/auth/chzzk/callback`;
const OPENAPI_BASE = process.env.CHZZK_OPENAPI_BASE || 'https://openapi.chzzk.naver.com';
const API_BASE = process.env.CHZZK_API_BASE || OPENAPI_BASE;
const CHZZK_UNOFFICIAL_API_BASE = process.env.CHZZK_UNOFFICIAL_API_BASE || 'https://api.chzzk.naver.com';
const CIME_CLIENT_ID = process.env.CIME_CLIENT_ID;
const CIME_CLIENT_SECRET = process.env.CIME_CLIENT_SECRET;
const CIME_REDIRECT_URI = process.env.CIME_REDIRECT_URI || `http://localhost:${PORT}/api/auth/cime/callback`;
const CIME_OPENAPI_BASE = process.env.CIME_OPENAPI_BASE || 'https://ci.me/api/openapi';
const CIME_AUTH_URL = process.env.CIME_AUTH_URL || 'https://ci.me/auth/openapi/account-interlock';
const CIME_AUTH_SCOPE = String(
  process.env.CIME_AUTH_SCOPE ||
  'READ:CHANNEL READ:LIVE_CHAT WRITE:LIVE_CHAT READ:DONATION READ:SUBSCRIPTION'
).trim();
const CIME_APP_API_BASE = process.env.CIME_APP_API_BASE || 'https://ci.me/api/app';
const CIME_UNOFFICIAL_PROFILE_URL_TEMPLATE = process.env.CIME_UNOFFICIAL_PROFILE_URL_TEMPLATE || '';
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_YOUTUBE_CLIENT_ID || '';
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_YOUTUBE_CLIENT_SECRET || '';
function normalizeYoutubeRedirectUri(rawValue) {
  const configured = String(rawValue || '').trim();
  const fallback = `http://localhost:${PORT}/api/auth/youtube/callback`;
  const value = configured || fallback;
  try {
    const url = new URL(value);
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol === 'http:' && !isLocal) {
      url.protocol = 'https:';
    }
    return url.toString();
  } catch {
    return value;
  }
}
const YOUTUBE_REDIRECT_URI = normalizeYoutubeRedirectUri(
  process.env.YOUTUBE_REDIRECT_URI ||
  (BACKEND_ORIGIN ? `${String(BACKEND_ORIGIN).replace(/\/$/, '')}/api/auth/youtube/callback` : '')
);
const YOUTUBE_BOT_AUTH_SCOPE = String(
  process.env.YOUTUBE_BOT_AUTH_SCOPE ||
  process.env.YOUTUBE_AUTH_SCOPE ||
  'https://www.googleapis.com/auth/youtube.force-ssl'
).trim();
const YOUTUBE_CHANNEL_READ_AUTH_SCOPE = String(
  process.env.YOUTUBE_CHANNEL_READ_AUTH_SCOPE ||
  process.env.YOUTUBE_VIEWER_AUTH_SCOPE ||
  'https://www.googleapis.com/auth/youtube.readonly'
).trim();
const YOUTUBE_VIEWER_AUTH_SCOPE = String(
  process.env.YOUTUBE_VIEWER_AUTH_SCOPE ||
  YOUTUBE_CHANNEL_READ_AUTH_SCOPE
).trim();
const YOUTUBE_STREAMER_AUTH_SCOPE = String(
  process.env.YOUTUBE_STREAMER_AUTH_SCOPE ||
  YOUTUBE_CHANNEL_READ_AUTH_SCOPE
).trim();
const YOUTUBE_API_BASE = process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_AUTH_URL = process.env.YOUTUBE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const YOUTUBE_TOKEN_URL = process.env.YOUTUBE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const YOUTUBE_REVOKE_URL = process.env.YOUTUBE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke';
const YOUTUBE_CHAT_FETCH_INTERVAL_MS = Number(process.env.YOUTUBE_CHAT_FETCH_INTERVAL_MS || 1000);
const YOUTUBE_BOT_PROFILE_ID = process.env.YOUTUBE_BOT_PROFILE_ID || 'default';
const YOUTUBE_WEBSUB_HUB_URL = process.env.YOUTUBE_WEBSUB_HUB_URL || 'https://pubsubhubbub.appspot.com/subscribe';
const YOUTUBE_WEBSUB_CALLBACK_PATH = process.env.YOUTUBE_WEBSUB_CALLBACK_PATH || '/api/youtube/websub/callback';
const YOUTUBE_WEBSUB_VERIFY_TOKEN = process.env.YOUTUBE_WEBSUB_VERIFY_TOKEN || '';
const YOUTUBE_WEBSUB_RETRY_DELAYS_MS = [15 * 1000, 60 * 1000, 3 * 60 * 1000, 5 * 60 * 1000];
const PLATFORM_PROFILE_TIMEOUT_MS = Number(process.env.PLATFORM_PROFILE_TIMEOUT_MS || 2500);
const platformProfiles = createPlatformProfileService({
  chzzkApiBase: CHZZK_UNOFFICIAL_API_BASE,
  cimeAppApiBase: CIME_APP_API_BASE,
  cimeProfileUrlTemplate: CIME_UNOFFICIAL_PROFILE_URL_TEMPLATE,
  timeoutMs: PLATFORM_PROFILE_TIMEOUT_MS,
  httpGet: async (url, options = {}) => {
    const response = await axios.get(url, {
      ...options,
      validateStatus: (status) => status >= 200 && status < 300
    });
    return response.data;
  }
});
// YouTube Data API v3 (optional)
const YT_API_KEY = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY || '';
// Optional per-resource paths. Use {channelId} placeholder when needed.
const CHAT_PATH = process.env.CHZZK_API_CHAT_PATH || '';
const DONATION_PATH = process.env.CHZZK_API_DONATION_PATH || '';
const SUBSCRIPTION_PATH = process.env.CHZZK_API_SUBSCRIPTION_PATH || '';

if (!CHZZK_CLIENT_ID || !CHZZK_CLIENT_SECRET) {
  console.warn('[CHZZK] Missing CHZZK_CLIENT_ID or CHZZK_CLIENT_SECRET in environment. OAuth will not work until set.');
}
if (!CIME_CLIENT_ID || !CIME_CLIENT_SECRET) {
  console.warn('[CIME] Missing CIME_CLIENT_ID or CIME_CLIENT_SECRET in environment. CIME OAuth will not work until set.');
}
if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
  console.warn('[YouTube] Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET in environment. YouTube OAuth will not work until set.');
}

// Record active sid on every request (best-effort)
app.use(async (req, res, next) => {
  try {
    const sid = await getPartitionId(req, res);
    if (sid) activeSids.set(sid, Date.now());
  } catch { }
  next();
});

// ---------------- WARUDO Direct Integration (Event Queue per owner) ----------------
// In-memory per-owner queue and waiters (best-effort; process memory)
const warudoQueues = new Map(); // pid -> { items: [], waiters: [] }
const pidSockets = new Map();   // pid -> Set<WebSocket>
// Desktop WS sockets per owner (Electron desktop client)
const desktopPidSockets = new Map(); // pid -> Set<WebSocket>

// Broadcast a payload to all desktop clients of an owner pid
function broadcastToDesktop(pid, payload) {
  try {
    const set = desktopPidSockets.get(pid);
    if (!set || set.size === 0) return 0;
    const msg = JSON.stringify(payload);
    let sent = 0;
    for (const ws of Array.from(set)) {
      try { if (ws.readyState === 1) { ws.send(msg, { compress: false }); sent++; } } catch { }
    }
    return sent;
  } catch { return 0; }
}

function getQueue(pid) {
  let q = warudoQueues.get(pid);
  if (!q) { q = { items: [], waiters: [] }; warudoQueues.set(pid, q); }
  return q;
}

function enqueueWarudoEvent(pid, payload) {
  const q = getQueue(pid);
  // If someone is waiting, deliver immediately
  const waiter = q.waiters.shift();
  if (waiter) {
    try { waiter.resolve(payload); } catch { }
    return true;
  }
  q.items.push(payload);
  // Also broadcast to any WS clients connected under this pid
  try {
    const set = pidSockets.get(pid);
    if (set && set.size > 0) {
      const msg = JSON.stringify({ event: payload, eventData: payload });
      let sent = 0;
      for (const ws of Array.from(set)) {
        try { if (ws.readyState === 1) { ws.send(msg); sent++; } } catch { }
      }
    }
  } catch (e) { console.error('[warudo enqueue] error: ', e?.message || e); }
  return true;
}

function emitWarudoEvent(pid, payload) {
  try { enqueueWarudoEvent(pid, payload); } catch { }
  if (redisEnabled && redisPublisher) {
    (async () => {
      try {
        const channel = `warudo:pid:${pid}`;
        const msg = JSON.stringify({ sender: INSTANCE_ID, payload });
        await redisPublisher.publish(channel, msg);
      } catch (e) { console.warn('[Redis] publish error', e?.message || e); }
    })();
  }
}

async function nextWarudoEvent(pid, timeoutMs = 25000) {
  const q = getQueue(pid);
  if (q.items.length > 0) return q.items.shift();
  // Long-poll wait
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      // timeout: no event
      resolve(null);
    }, Math.max(1000, Math.min(30000, Number(timeoutMs) || 25000)));
    q.waiters.push({ resolve: (v) => { try { clearTimeout(timer); } catch { } resolve(v); } });
  });
}

// Producer: push event using API key owner (no cookie)
// POST /api/warudo/events/push { command, args, userId, username }
app.post('/api/warudo/events/push', async (req, res) => {
  try {
    const pid = await getPartitionIdByApiKey(req);
    if (!pid) return res.status(401).json({ error: 'API key required' });
    const body = req.body || {};
    const payload = {
      command: body.command ?? '',
      args: Array.isArray(body.args) ? body.args.map(String) : [],
      userId: body.userId != null ? String(body.userId) : '',
      username: body.username != null ? String(body.username) : ''
    };
    enqueueWarudoEvent(pid, payload);
    // Publish to other instances via Redis
    if (redisEnabled && redisPublisher) {
      try {
        const channel = `warudo:pid:${pid}`;
        const msg = JSON.stringify({ sender: INSTANCE_ID, payload });
        await redisPublisher.publish(channel, msg);
      } catch (e) { console.warn('[Redis] publish error', e?.message || e); }
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[warudo:push] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to push event' });
  }
});

// Consumer (WARUDO): long-poll next event using API key owner (no cookie)
// GET /api/warudo/events/next?timeout=25000
app.get('/api/warudo/events/next', async (req, res) => {
  try {
    const pid = await getPartitionIdByApiKey(req);
    if (!pid) return res.status(401).json({ error: 'API key required' });
    const timeout = Math.max(1000, Math.min(30000, Number(req.query.timeout || 25000) || 25000));
    const evt = await nextWarudoEvent(pid, timeout);
    return res.json({ event: evt, eventData: evt });
  } catch (e) {
    console.error('[warudo:next] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to get next event' });
  }
});

// Debug: inspect current WS registrations (requires API key)
app.get('/api/warudo/debug/ws', async (req, res) => {
  try {
    const pid = await getPartitionIdByApiKey(req);
    if (!pid) return res.status(401).json({ error: 'API key required' });
    const own = pidSockets.get(pid);
    const summary = {
      yourPid: pid,
      yourSocketCount: own ? own.size : 0,
    };
    return res.json(summary);
  } catch (e) {
    return res.status(500).json({ error: 'debug failed' });
  }
});

validateSecretEncryptionConfig();
validateDatabaseProviderConfig();
await initDb();

async function refreshPostgRESTSchema() {
  try {
    if (!shouldRefreshPostgRESTSchema()) return;
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (supabaseUrl && serviceRoleKey) {
      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('[Server] PostgREST schema cache refreshed');
    }
  } catch (e) {
    console.warn('[Server] Failed to refresh PostgREST schema cache:', e.message);
  }
}

await refreshPostgRESTSchema();

try {
  console.log('[Server] Initializing roulette sessions table...');
  const { ensureRouletteSessionsPg } = await import('./supabase.js');
  await ensureRouletteSessionsPg();
  console.log('[Server] Roulette sessions table initialized successfully');
} catch (e) {
  console.warn('[Server] Failed to initialize roulette sessions table:', e?.message || e);
}

try {
  console.log('[Server] Starting channel ID migration...');

  if (hasDirectDatabaseUrl()) {
    const { runMigrations, migrateChannelIdData, verifyChannelIdIntegrity } = await import('./supabase.js');

    await runMigrations();

    await migrateChannelIdData();

    const integrityResult = await verifyChannelIdIntegrity();
    console.log('[Server] Channel ID integrity check:', integrityResult);
  }

  const { migrateChannelIdDataSQLite, startTokenCleanupScheduler, startPerformanceMonitoringScheduler, optimizeDatabase } = await import('./sqlite.js');
  migrateChannelIdDataSQLite();

  startTokenCleanupScheduler();

  startPerformanceMonitoringScheduler();

  if (shouldRunDatabaseMaintenance()) {
    const { startPerformanceMonitoringSchedulerSupabase } = await import('./supabase.js');
    await startPerformanceMonitoringSchedulerSupabase();
  }

  const optimizationResult = optimizeDatabase();
  if (optimizationResult.success) {
    console.log(`[Server] Database optimization completed in ${optimizationResult.executionTime}ms`);
  }

  console.log('[Server] Channel ID migration and performance optimization completed successfully');
} catch (e) {
  console.warn('[Server] Channel ID migration failed:', e?.message || e);
}

const liveSession = new Map(); // sid -> { live: boolean, startDate?: string, sessionStartTime?: number, lastUpdate: number }

// =============================
// =============================
const MEMORY_LIMITS = {
  MAX_LIVE_SESSIONS: 1000,
  MAX_CACHE_AGE_MS: 24 * 60 * 60 * 1000, // 24?쒓컙
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
  MEMORY_CHECK_INTERVAL_MS: 10 * 60 * 1000
};

class MemoryManager {
  constructor() {
    this.lastCleanup = Date.now();
    this.lastMemoryCheck = Date.now();
    this.cleanupStats = {
      totalCleanups: 0,
      itemsRemoved: 0,
      lastCleanupAt: null
    };
  }

  checkMemoryUsage() {
    const now = Date.now();
    if (now - this.lastMemoryCheck < MEMORY_LIMITS.MEMORY_CHECK_INTERVAL_MS) {
      return;
    }

    this.lastMemoryCheck = now;

    try {
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

      console.log(`[Memory] Heap: ${heapUsedMB}MB / ${heapTotalMB}MB, Sessions: ${liveSession.size}, Caches: ${liveInfoCache.size + liveCache.size}`);

      if (heapUsedMB > 500) {
        console.log('[Memory] High memory usage detected, forcing cleanup...');
        this.performMemoryCleanup(true);
      }
    } catch (error) {
      console.error('[Memory] Failed to check memory usage:', error);
    }
  }

  performMemoryCleanup(force = false) {
    const now = Date.now();

    if (!force && now - this.lastCleanup < MEMORY_LIMITS.CLEANUP_INTERVAL_MS) {
      return { skipped: true, reason: 'too_soon' };
    }

    this.lastCleanup = now;
    let removedCount = 0;

    try {
      const cutoffTime = now - MEMORY_LIMITS.MAX_CACHE_AGE_MS;

      for (const [sid, session] of liveSession.entries()) {
        if (!session.live && session.lastUpdate < cutoffTime) {
          liveSession.delete(sid);
          removedCount++;
        }
      }

      if (liveSession.size > MEMORY_LIMITS.MAX_LIVE_SESSIONS) {
        const inactiveSessions = Array.from(liveSession.entries())
          .filter(([_, session]) => !session.live)
          .sort((a, b) => a[1].lastUpdate - b[1].lastUpdate);

        const excessCount = liveSession.size - MEMORY_LIMITS.MAX_LIVE_SESSIONS;
        const toRemove = inactiveSessions.slice(0, excessCount);

        for (const [sid] of toRemove) {
          liveSession.delete(sid);
          removedCount++;
        }
      }

      this.cleanupOtherCaches(cutoffTime);

      this.cleanupStats.totalCleanups++;
      this.cleanupStats.itemsRemoved += removedCount;
      this.cleanupStats.lastCleanupAt = new Date().toISOString();

      if (removedCount > 0 || force) {
        console.log(`[Memory] Cleanup completed: removed ${removedCount} sessions, total: ${liveSession.size}`);
      }

      return {
        success: true,
        removedCount,
        totalSessions: liveSession.size,
        force
      };
    } catch (error) {
      console.error('[Memory] Cleanup failed:', error);
      return { success: false, error: error.message };
    }
  }

  cleanupOtherCaches(cutoffTime) {
    let cleaned = 0;

    try {
      // liveInfoCache ?뺣━
      for (const [sid, info] of liveInfoCache.entries()) {
        if (info.ts < cutoffTime) {
          liveInfoCache.delete(sid);
          cleaned++;
        }
      }

      // liveCache ?뺣━
      for (const [sid, cache] of liveCache.entries()) {
        if (cache.checkedAt < cutoffTime) {
          liveCache.delete(sid);
          cleaned++;
        }
      }

      // macroCache ?뺣━
      for (const [sid, cache] of macroCache.entries()) {
        if (cache.fetchedAt < cutoffTime) {
          macroCache.delete(sid);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`[Memory] Cleaned ${cleaned} cache entries`);
      }
    } catch (error) {
      console.error('[Memory] Failed to clean other caches:', error);
    }
  }

  getMemoryReport() {
    const memUsage = process.memoryUsage();

    return {
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024)
      },
      caches: {
        liveSession: liveSession.size,
        liveInfoCache: liveInfoCache.size,
        liveCache: liveCache.size,
        macroCache: macroCache.size
      },
      limits: MEMORY_LIMITS,
      cleanupStats: this.cleanupStats,
      timestamp: new Date().toISOString()
    };
  }

  addSessionWithSizeCheck(sid, sessionData) {
    if (liveSession.size >= MEMORY_LIMITS.MAX_LIVE_SESSIONS) {
      this.performMemoryCleanup(true);
    }

    liveSession.set(sid, sessionData);

    this.checkMemoryUsage();
  }
}

const memoryManager = new MemoryManager();

try {
  const activeSessions = await initializeLiveSessionsOnStartup();

  for (const session of activeSessions) {
    memoryManager.addSessionWithSizeCheck(session.sid, {
      live: session.live,
      startDate: session.start_date,
      sessionStartTime: session.session_start_time,
      lastUpdate: session.last_update
    });
  }

  console.log(`[Session] Restored ${activeSessions.length} live sessions to memory cache`);
} catch (error) {
  console.warn('[Session] Live session restore skipped:', error?.message || error);
}

setInterval(() => {
  try {
    memoryManager.performMemoryCleanup();
  } catch (error) {
    console.error('[Memory] Periodic cleanup failed:', error);
  }
}, MEMORY_LIMITS.CLEANUP_INTERVAL_MS);

setInterval(() => {
  try {
    memoryManager.checkMemoryUsage();
  } catch (error) {
    console.error('[Memory] Periodic memory check failed:', error);
  }
}, MEMORY_LIMITS.MEMORY_CHECK_INTERVAL_MS);

console.log('[Memory] Periodic cleanup and monitoring started');

const PRIVACY_RETENTION_CLEANUP_INTERVAL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.ARUBOT_PRIVACY_RETENTION_CLEANUP_INTERVAL_MS || 24 * 60 * 60 * 1000)
);
const PRIVACY_RETENTION_CLEANUP_ENABLED = String(process.env.ARUBOT_PRIVACY_RETENTION_CLEANUP || 'true').trim().toLowerCase() !== 'false';
let privacyRetentionCleanupRunning = false;

async function runPrivacyRetentionCleanup(reason = 'scheduled') {
  if (!PRIVACY_RETENTION_CLEANUP_ENABLED || privacyRetentionCleanupRunning) return null;
  privacyRetentionCleanupRunning = true;
  try {
    const result = await cleanupPrivacyRetentionData();
    console.log('[Privacy] Retention cleanup completed:', {
      reason,
      deleted: result.deleted,
      objectKeysDeleted: result.objectKeysDeleted,
      objectKeysSkipped: result.objectKeysSkipped
    });
    return result;
  } catch (error) {
    console.warn('[Privacy] Retention cleanup failed:', error?.message || error);
    return null;
  } finally {
    privacyRetentionCleanupRunning = false;
  }
}

if (PRIVACY_RETENTION_CLEANUP_ENABLED) {
  setTimeout(() => { runPrivacyRetentionCleanup('startup').catch(() => null); }, 30 * 1000);
  setInterval(() => { runPrivacyRetentionCleanup('scheduled').catch(() => null); }, PRIVACY_RETENTION_CLEANUP_INTERVAL_MS);
  console.log('[Privacy] Retention cleanup scheduler started');
}

function getCookieSid(req) {
  if (req.cookies?.sid) return req.cookies.sid;
  const rawCookie = String(req.headers?.cookie || '');
  if (!rawCookie) return null;
  for (const part of rawCookie.split(';')) {
    const [rawName, ...rawValue] = part.split('=');
    if (String(rawName || '').trim() !== 'sid') continue;
    try {
      return decodeURIComponent(rawValue.join('=').trim());
    } catch {
      return rawValue.join('=').trim();
    }
  }
  return null;
}

// =============================
// =============================

async function getChannelContext(sid) {
  try {
    if (!sid) return null;

    //
    let userId = null;

    if (sid.startsWith('user:')) {
      userId = sid.slice(5);
    } else {
      userId = sid;
    }

    const channelId = await resolveChannelIdForOwnerUserId(userId, { provider: 'chzzk' });
    if (!channelId) return null;

    const cacheKey = `context:${sid}`;
    let context = channelCache.get(channelId, cacheKey);

    if (context) {
      context.lastActivity = Date.now();
      channelCache.set(channelId, cacheKey, context, CACHE_TTL);
      return context;
    }

    context = {
      sid,
      channelId,
      userId,
      lastActivity: Date.now(),
      sessionKey: null,
      isolationLevel: 'strict',
      connectionId: `context_${Date.now()}_${Math.random().toString(36).slice(2)}`
    };

    channelCache.set(channelId, cacheKey, context, CACHE_TTL);

    console.log(`[ChannelContext] Created new context: sid=${sid}, channelId=${channelId}`);
    return context;

  } catch (error) {
    console.error('[ChannelContext] Failed to get channel context:', error);
    return null;
  }
}

function getChannelIdFromUserId(userId) {
  const rawUserId = String(userId || '').trim();
  const channelId = rawUserId.startsWith('cime:') ? rawUserId.slice(5) : rawUserId;

  if (!channelId || channelId.length < 3) {
    return null;
  }

  return channelId;
}

async function resolveChannelIdForOwnerUserId(userId, options = {}) {
  const ownerUserId = String(userId || '').replace(/^user:/, '').trim();
  if (!ownerUserId) return null;
  const providerHint = String(options.provider || '').trim().toLowerCase();
  const allowFallback = options.allowFallback !== false;

  try {
    const accounts = await listPlatformAccounts(ownerUserId);
    const providerAccounts = providerHint
      ? (accounts || []).filter((account) => String(account?.provider || '').toLowerCase() === providerHint)
      : [
          ...(accounts || []).filter((account) => String(account?.provider || '').toLowerCase() === 'chzzk'),
          ...(accounts || []).filter((account) => String(account?.provider || '').toLowerCase() !== 'chzzk'),
        ];
    const preferred = providerAccounts.find((account) => (
      validateChannelId(String(account?.channel_id || account?.channelId || account?.platform_user_id || account?.platformUserId || ''))
    )) || (!providerHint ? (accounts || []).find((account) => (
      validateChannelId(String(account?.channel_id || account?.channelId || account?.platform_user_id || account?.platformUserId || ''))
    )) : null);

    const accountChannelId = String(
      preferred?.channel_id ||
      preferred?.channelId ||
      preferred?.platform_user_id ||
      preferred?.platformUserId ||
      ''
    ).trim();
    if (validateChannelId(accountChannelId)) return accountChannelId;
  } catch (error) {
    console.warn('[ChannelContext] Failed to resolve platform account channel ID:', error?.message || error);
  }

  if (!allowFallback) return null;
  const fallback = getChannelIdFromUserId(ownerUserId);
  return validateChannelId(fallback) ? fallback : null;
}

function validateChannelId(channelId) {
  if (!channelId || typeof channelId !== 'string') {
    return false;
  }

  const trimmed = channelId.trim();

  if (trimmed.length < 3 || trimmed.length > 100) {
    return false;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return false;
  }

  return true;
}

/**
 *
 */
async function validateChannelAccess(token, tokenType, expectedChannelId) {
  try {
    if (!token || !tokenType || !expectedChannelId) {
      return false;
    }

    let sid = null;
    if (tokenType === 'roulette') {
      sid = rouletteTokenToSid.get(token);
      if (!sid) {
        sid = await findSidByRouletteToken(token);
        if (sid) {
          rouletteTokenToSid.set(token, sid);
        }
      }
    } else if (tokenType === 'pvd') {
      sid = pvdTokenToSid.get(token);
      if (!sid) {
        sid = await findSidByViewerToken(token);
        if (sid) {
          pvdTokenToSid.set(token, sid);
        }
      }
    }

    if (!sid) {
      console.warn(`[Channel Access] Token not found: ${tokenType} ${token.substring(0, 8)}...`);
      return false;
    }

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      console.warn(`[Channel Access] No channel context for sid: ${sid}`);
      return false;
    }

    if (channelContext.channelId !== expectedChannelId) {
      console.warn(`[Channel Access] Channel mismatch: token maps to ${channelContext.channelId}, expected ${expectedChannelId}`);
      return false;
    }

    console.log(`[Channel Access] Validated: ${tokenType} token ${token.substring(0, 8)}... -> channel ${expectedChannelId}`);
    return true;

  } catch (error) {
    console.error(`[Channel Access] Validation error:`, error);
    return false;
  }
}

// =============================
// =============================

/**
 */
/**
 */
async function generateChannelRouletteToken(channelId) {
  try {
    if (!channelId || !validateChannelId(channelId)) {
      throw new Error('Invalid channel ID for token generation');
    }

    const limitCheck = await checkTokenGenerationLimit(channelId);
    if (!limitCheck.allowed) {
      throw new Error(`Token generation denied: ${limitCheck.reason}`);
    }

    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).slice(2, 10);
    const channelHash = crypto.createHash('sha256')
      .update(channelId + (process.env.TOKEN_SECRET || 'default_secret'))
      .digest('hex')
      .slice(0, 8);

    const token = `rlt_${channelHash}_${timestamp}_${randomPart}`;

    const integrityCheck = await verifyTokenIntegrity(token, channelId);
    if (!integrityCheck.valid) {
      throw new Error(`Token integrity verification failed: ${integrityCheck.error}`);
    }

    registerTokenChannelMapping(token, channelId);

    console.log(`[Channel Token] Generated roulette token for channel: ${channelId}, token: ${token.substring(0, 16)}... (${limitCheck.currentCount + 1} total)`);

    return token;

  } catch (error) {
    console.error('[Channel Token] Failed to generate roulette token:', error);
    throw new Error(`Token generation failed: ${error.message}`);
  }
}

/**
 */
async function generateChannelPvdToken(channelId) {
  try {
    if (!channelId || !validateChannelId(channelId)) {
      throw new Error('Invalid channel ID for PVD token generation');
    }

    const limitCheck = await checkTokenGenerationLimit(channelId);
    if (!limitCheck.allowed) {
      throw new Error(`PVD token generation denied: ${limitCheck.reason}`);
    }

    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).slice(2, 10);
    const channelHash = crypto.createHash('sha256')
      .update(channelId + (process.env.TOKEN_SECRET || 'default_secret'))
      .digest('hex')
      .slice(0, 8);

    const token = `pvd_${channelHash}_${timestamp}_${randomPart}`;

    const integrityCheck = await verifyTokenIntegrity(token, channelId);
    if (!integrityCheck.valid) {
      throw new Error(`PVD token integrity verification failed: ${integrityCheck.error}`);
    }

    registerTokenChannelMapping(token, channelId);

    console.log(`[Channel Token] Generated PVD token for channel: ${channelId}, token: ${token.substring(0, 16)}... (${limitCheck.currentCount + 1} total)`);

    return token;

  } catch (error) {
    console.error('[Channel Token] Failed to generate PVD token:', error);
    throw new Error(`PVD token generation failed: ${error.message}`);
  }
}

/**
 */
async function generateChannelToken(channelId, tokenType) {
  try {
    if (!channelId || !tokenType) {
      throw new Error('Channel ID and token type are required');
    }

    switch (tokenType) {
      case 'roulette':
        return await generateChannelRouletteToken(channelId);
      case 'pvd':
        return await generateChannelPvdToken(channelId);
      default:
        throw new Error(`Unsupported token type: ${tokenType}`);
    }

  } catch (error) {
    console.error('[Channel Token] Failed to generate token:', error);
    throw error;
  }
}

/**
 */
async function validateChannelToken(token, expectedChannelId = null, trackUsage = true, clientIp = null) {
  try {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Invalid token format' };
    }

    let tokenType = null;
    if (token.startsWith('rlt_')) {
      tokenType = 'roulette';
    } else if (token.startsWith('pvd_')) {
      tokenType = 'pvd';
    } else {
      return { valid: false, error: 'Unknown token type' };
    }

    const integrityCheck = await verifyTokenIntegrity(token, expectedChannelId);
    if (!integrityCheck.valid) {
      return { valid: false, error: integrityCheck.error };
    }

    const tokenChannelId = integrityCheck.channelId;

    if (expectedChannelId && tokenChannelId !== expectedChannelId) {
      return {
        valid: false,
        error: 'Channel ID mismatch',
        channelId: tokenChannelId
      };
    }

    const securityCheck = await validateTokenSecurity(token, clientIp);
    if (!securityCheck.allowed) {
      return { valid: false, error: securityCheck.reason };
    }

    if (!integrityCheck.persistentToken) {
      const patterns = {
        roulette: /^rlt_([a-f0-9]{8})_([a-z0-9]+)_([a-z0-9]+)$/,
        pvd: /^pvd_([a-f0-9]{8})_([a-z0-9]+)_([a-z0-9]+)$/
      };

      const match = token.match(patterns[tokenType]);
      if (!match) {
        return { valid: false, error: 'Invalid token pattern' };
      }

      const [, channelHash, timestamp, randomPart] = match;

      const tokenTime = parseInt(timestamp, 36);
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24?쒓컙

      if (isNaN(tokenTime) || tokenTime <= 0) {
        return { valid: false, error: 'Invalid timestamp format' };
      }

      if (now - tokenTime > maxAge) {
        return { valid: false, error: 'Token expired' };
      }
    }

    let usageCount = 0;
    if (trackUsage) {
      trackTokenUsage(token, tokenChannelId);
      const stats = tokenUsageStats.get(token);
      usageCount = stats ? stats.usageCount : 1;
    }

    return {
      valid: true,
      channelId: tokenChannelId,
      tokenType,
      usageCount: trackUsage ? usageCount : undefined
    };

  } catch (error) {
    console.error('[Channel Token] Validation error:', error);
    return { valid: false, error: 'Validation failed' };
  }
}

/**
 */
const channelTokenMapping = new Map(); // token -> { channelId, createdAt, lastUsed }
const channelTokensByChannel = new Map(); // channelId -> Set<token>

/**
 */
function registerTokenChannelMapping(token, channelId) {
  try {
    if (!token || !channelId) return;

    const now = Date.now();

    channelTokenMapping.set(token, {
      channelId,
      createdAt: now,
      lastUsed: now
    });

    if (!channelTokensByChannel.has(channelId)) {
      channelTokensByChannel.set(channelId, new Set());
    }
    channelTokensByChannel.get(channelId).add(token);

    console.log(`[Token Mapping] Registered token for channel: ${channelId}, token: ${token.substring(0, 16)}...`);

  } catch (error) {
    console.error('[Token Mapping] Registration error:', error);
  }
}

/**
 */
function unregisterTokenChannelMapping(token) {
  try {
    if (!token) return;

    const mapping = channelTokenMapping.get(token);
    if (mapping) {
      const { channelId } = mapping;

      channelTokenMapping.delete(token);

      const tokenSet = channelTokensByChannel.get(channelId);
      if (tokenSet) {
        tokenSet.delete(token);
        if (tokenSet.size === 0) {
          channelTokensByChannel.delete(channelId);
        }
      }

      console.log(`[Token Mapping] Unregistered token for channel: ${channelId}, token: ${token.substring(0, 16)}...`);
    }

  } catch (error) {
    console.error('[Token Mapping] Unregistration error:', error);
  }
}

/**
 */
function revokeChannelTokens(channelId) {
  try {
    if (!channelId) return;

    const tokenSet = channelTokensByChannel.get(channelId);
    if (tokenSet && tokenSet.size > 0) {
      const tokens = Array.from(tokenSet);

      for (const token of tokens) {
        channelTokenMapping.delete(token);
      }

      channelTokensByChannel.delete(channelId);

      console.log(`[Token Mapping] Revoked ${tokens.length} tokens for channel: ${channelId}`);
      return tokens.length;
    }

    return 0;

  } catch (error) {
    console.error('[Token Mapping] Revocation error:', error);
    return 0;
  }
}

/**
 */
function cleanupExpiredTokens() {
  try {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24?쒓컙
    let cleanedCount = 0;

    for (const [token, mapping] of channelTokenMapping.entries()) {
      if (now - mapping.createdAt > maxAge) {
        unregisterTokenChannelMapping(token);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[Token Mapping] Cleaned up ${cleanedCount} expired tokens`);
    }

    return cleanedCount;

  } catch (error) {
    console.error('[Token Mapping] Cleanup error:', error);
    return 0;
  }
}

setInterval(cleanupExpiredTokens, 60 * 60 * 1000);

/**
 */
const tokenUsageStats = new Map(); // token -> { usageCount, lastUsed, firstUsed, channelId }

/**
 */
function trackTokenUsage(token, channelId, tokenType = 'unknown', userId = null, ip = 'unknown', userAgent = 'unknown') {
  try {
    if (!token || !channelId) return;

    const now = Date.now();
    const existing = tokenUsageStats.get(token);

    if (existing) {
      existing.usageCount++;
      existing.lastUsed = now;
    } else {
      tokenUsageStats.set(token, {
        usageCount: 1,
        firstUsed: now,
        lastUsed: now,
        channelId
      });
    }

    const mapping = channelTokenMapping.get(token);
    if (mapping) {
      mapping.lastUsed = now;
    }

    if (securityEventLog && typeof securityEventLog.tokenUsageTracking !== 'undefined') {
      const oneHour = 60 * 60 * 1000;

      if (!securityEventLog.tokenUsageTracking.has(token)) {
        securityEventLog.tokenUsageTracking.set(token, {
          tokenType,
          usageCount: 0,
          firstUsed: now,
          lastUsed: now,
          channels: new Set(),
          ips: new Set(),
          userAgents: new Set(),
          hourlyUsage: []
        });
      }

      const usage = securityEventLog.tokenUsageTracking.get(token);
      usage.usageCount++;
      usage.lastUsed = now;
      usage.channels.add(channelId);
      usage.ips.add(ip);
      usage.userAgents.add(userAgent);

      usage.hourlyUsage.push(now);
      usage.hourlyUsage = usage.hourlyUsage.filter(time => now - time < oneHour);

      if (usage.hourlyUsage.length > 50 || usage.channels.size > 1 || usage.ips.size > 3) {
        securityEventLog.suspiciousTokens.add(token);

        monitorSuspiciousActivity(userId, ip, 'TOKEN_USAGE', {
          token: token.substring(0, 8) + '...',
          tokenType,
          channelId,
          usageCount: usage.usageCount,
          hourlyCount: usage.hourlyUsage.length,
          channelCount: usage.channels.size,
          ipCount: usage.ips.size
        });
      }
    }

  } catch (error) {
    console.error('[Token Stats] Usage tracking error:', error);
  }
}

/**
 */
function getTokenUsageStats(token = null, channelId = null) {
  try {
    if (token) {
      return tokenUsageStats.get(token) || null;
    }

    if (channelId) {
      const channelStats = [];
      for (const [tokenKey, stats] of tokenUsageStats.entries()) {
        if (stats.channelId === channelId) {
          channelStats.push({
            token: tokenKey.substring(0, 16) + '...',
            ...stats
          });
        }
      }
      return channelStats;
    }

    const summary = {
      totalTokens: tokenUsageStats.size,
      totalUsage: 0,
      channelBreakdown: new Map()
    };

    for (const [tokenKey, stats] of tokenUsageStats.entries()) {
      summary.totalUsage += stats.usageCount;

      const channelCount = summary.channelBreakdown.get(stats.channelId) || 0;
      summary.channelBreakdown.set(stats.channelId, channelCount + stats.usageCount);
    }

    summary.channelBreakdown = Object.fromEntries(summary.channelBreakdown);

    return summary;

  } catch (error) {
    console.error('[Token Stats] Stats retrieval error:', error);
    return null;
  }
}

/**
 */
function cleanupTokenStats(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  try {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [token, stats] of tokenUsageStats.entries()) {
      if (now - stats.lastUsed > maxAgeMs) {
        tokenUsageStats.delete(token);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[Token Stats] Cleaned up ${cleanedCount} old token statistics`);
    }

    return cleanedCount;

  } catch (error) {
    console.error('[Token Stats] Stats cleanup error:', error);
    return 0;
  }
}

/**
 */
async function revokeExpiredChannelTokens(channelId, maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    if (!channelId) return 0;

    const now = Date.now();
    let revokedCount = 0;

    const tokenSet = channelTokensByChannel.get(channelId);
    if (!tokenSet || tokenSet.size === 0) {
      return 0;
    }

    const tokensToRevoke = [];

    for (const token of tokenSet) {
      const mapping = channelTokenMapping.get(token);
      if (mapping && (now - mapping.createdAt > maxAgeMs)) {
        tokensToRevoke.push(token);
      }
    }

    for (const token of tokensToRevoke) {
      unregisterTokenChannelMapping(token);
      tokenUsageStats.delete(token);
      revokedCount++;
    }

    if (revokedCount > 0) {
      console.log(`[Token Management] Revoked ${revokedCount} expired tokens for channel: ${channelId}`);
    }

    return revokedCount;

  } catch (error) {
    console.error('[Token Management] Expired token revocation error:', error);
    return 0;
  }
}

/**
 */
function getTokenManagementStatus(channelId = null) {
  try {
    const now = Date.now();
    const status = {
      timestamp: now,
      totalTokens: channelTokenMapping.size,
      totalChannels: channelTokensByChannel.size,
      usageStats: {
        totalTrackedTokens: tokenUsageStats.size,
        totalUsage: 0
      },
      channels: {}
    };

    for (const stats of tokenUsageStats.values()) {
      status.usageStats.totalUsage += stats.usageCount;
    }

    if (channelId) {
      const tokenSet = channelTokensByChannel.get(channelId);
      const channelInfo = {
        tokenCount: tokenSet ? tokenSet.size : 0,
        tokens: [],
        totalUsage: 0
      };

      if (tokenSet) {
        for (const token of tokenSet) {
          const mapping = channelTokenMapping.get(token);
          const stats = tokenUsageStats.get(token);

          const tokenInfo = {
            token: token.substring(0, 16) + '...',
            createdAt: mapping ? mapping.createdAt : null,
            lastUsed: mapping ? mapping.lastUsed : null,
            usageCount: stats ? stats.usageCount : 0,
            age: mapping ? (now - mapping.createdAt) : null
          };

          channelInfo.tokens.push(tokenInfo);
          channelInfo.totalUsage += tokenInfo.usageCount;
        }
      }

      status.channels[channelId] = channelInfo;
    } else {
      for (const [cId, tokenSet] of channelTokensByChannel.entries()) {
        let channelUsage = 0;
        for (const token of tokenSet) {
          const stats = tokenUsageStats.get(token);
          if (stats) {
            channelUsage += stats.usageCount;
          }
        }

        status.channels[cId] = {
          tokenCount: tokenSet.size,
          totalUsage: channelUsage
        };
      }
    }

    return status;

  } catch (error) {
    console.error('[Token Management] Status retrieval error:', error);
    return {
      timestamp: Date.now(),
      error: 'Failed to retrieve status'
    };
  }
}

setInterval(cleanupTokenStats, 24 * 60 * 60 * 1000);

/**
 */
async function runTokenMaintenanceScheduler() {
  try {
    console.log('[Token Scheduler] Starting token maintenance...');

    let totalCleaned = 0;
    let totalRevoked = 0;

    const cleanedTokens = cleanupExpiredTokens();
    totalCleaned += cleanedTokens;

    const cleanedStats = cleanupTokenStats();
    totalCleaned += cleanedStats;

    for (const [channelId] of channelTokensByChannel.entries()) {
      const revokedCount = await revokeExpiredChannelTokens(channelId);
      totalRevoked += revokedCount;
    }

    cleanupChannelConnections();

    console.log(`[Token Scheduler] Maintenance completed - Cleaned: ${totalCleaned}, Revoked: ${totalRevoked}`);

    return { cleaned: totalCleaned, revoked: totalRevoked };

  } catch (error) {
    console.error('[Token Scheduler] Maintenance error:', error);
    return { cleaned: 0, revoked: 0, error: error.message };
  }
}

setInterval(runTokenMaintenanceScheduler, 6 * 60 * 60 * 1000);

setTimeout(runTokenMaintenanceScheduler, 30 * 1000);

/**
 */
function generateTokenManagementReport() {
  try {
    const now = Date.now();
    const report = {
      timestamp: now,
      summary: {
        totalActiveTokens: channelTokenMapping.size,
        totalChannels: channelTokensByChannel.size,
        totalTrackedUsage: tokenUsageStats.size
      },
      channels: {},
      systemHealth: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
        tokenCacheHitRate: 0
      },
      recentActivity: {
        tokensCreatedLast24h: 0,
        tokensUsedLast24h: 0,
        mostActiveChannels: []
      }
    };

    const channelActivity = new Map();

    for (const [channelId, tokenSet] of channelTokensByChannel.entries()) {
      const channelInfo = {
        tokenCount: tokenSet.size,
        totalUsage: 0,
        recentTokens: 0,
        recentUsage: 0,
        oldestToken: null,
        newestToken: null
      };

      let oldestTime = Infinity;
      let newestTime = 0;

      for (const token of tokenSet) {
        const mapping = channelTokenMapping.get(token);
        const stats = tokenUsageStats.get(token);

        if (mapping) {
          if (mapping.createdAt < oldestTime) {
            oldestTime = mapping.createdAt;
            channelInfo.oldestToken = mapping.createdAt;
          }
          if (mapping.createdAt > newestTime) {
            newestTime = mapping.createdAt;
            channelInfo.newestToken = mapping.createdAt;
          }

          if (now - mapping.createdAt < 24 * 60 * 60 * 1000) {
            channelInfo.recentTokens++;
            report.recentActivity.tokensCreatedLast24h++;
          }
        }

        if (stats) {
          channelInfo.totalUsage += stats.usageCount;

          if (now - stats.lastUsed < 24 * 60 * 60 * 1000) {
            channelInfo.recentUsage += stats.usageCount;
            report.recentActivity.tokensUsedLast24h += stats.usageCount;
          }
        }
      }

      report.channels[channelId] = channelInfo;
      channelActivity.set(channelId, channelInfo.totalUsage);
    }

    const sortedChannels = Array.from(channelActivity.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    report.recentActivity.mostActiveChannels = sortedChannels.map(([channelId, usage]) => ({
      channelId,
      totalUsage: usage,
      tokenCount: report.channels[channelId].tokenCount
    }));

    return report;

  } catch (error) {
    console.error('[Token Report] Report generation error:', error);
    return {
      timestamp: Date.now(),
      error: 'Failed to generate report',
      details: error.message
    };
  }
}

/**
 */
function checkTokenSystemHealth() {
  try {
    const now = Date.now();
    const health = {
      timestamp: now,
      status: 'healthy',
      issues: [],
      metrics: {
        tokenMappingSize: channelTokenMapping.size,
        channelMappingSize: channelTokensByChannel.size,
        usageStatsSize: tokenUsageStats.size,
        sessionCacheSize: sessionContextCache.size
      },
      recommendations: []
    };

    const memUsage = process.memoryUsage();
    const memUsageMB = memUsage.heapUsed / 1024 / 1024;

    if (memUsageMB > 500) {
      health.issues.push({
        type: 'high_memory_usage',
        severity: 'warning',
        message: `High memory usage: ${memUsageMB.toFixed(2)}MB`,
        recommendation: 'Consider running token cleanup'
      });
      health.recommendations.push('Run token maintenance scheduler');
    }

    if (channelTokenMapping.size > 1000) {
      health.issues.push({
        type: 'high_token_count',
        severity: 'warning',
        message: `High token count: ${channelTokenMapping.size}`,
        recommendation: 'Review token expiration policies'
      });
    }

    const avgTokensPerChannel = channelTokensByChannel.size > 0
      ? channelTokenMapping.size / channelTokensByChannel.size
      : 0;

    if (avgTokensPerChannel > 20) {
      health.issues.push({
        type: 'high_tokens_per_channel',
        severity: 'info',
        message: `High average tokens per channel: ${avgTokensPerChannel.toFixed(1)}`,
        recommendation: 'Monitor token generation patterns'
      });
    }

    const warningCount = health.issues.filter(i => i.severity === 'warning').length;
    const errorCount = health.issues.filter(i => i.severity === 'error').length;

    if (errorCount > 0) {
      health.status = 'unhealthy';
    } else if (warningCount > 0) {
      health.status = 'degraded';
    }

    return health;

  } catch (error) {
    console.error('[Token Health] Health check error:', error);
    return {
      timestamp: Date.now(),
      status: 'error',
      error: 'Health check failed',
      details: error.message
    };
  }
}

/**
 */
function validateTokenType(token, expectedType) {
  if (!token || !expectedType) return false;

  if (expectedType === 'roulette') {
    return token.startsWith('rlt_');
  } else if (expectedType === 'pvd') {
    return token.startsWith('pvd_');
  }

  return false;
}

/**
 */
async function validateTokenSecurity(token, clientIp = null) {
  try {
    if (!token) {
      return { allowed: false, reason: 'Missing token' };
    }

    const stats = tokenUsageStats.get(token);
    if (stats) {
      const now = Date.now();
      const timeSinceLastUse = now - stats.lastUsed;

      if (timeSinceLastUse < 1000 && stats.usageCount > 10) {
        console.warn(`[Token Security] Rate limit exceeded for token: ${token.substring(0, 16)}...`);
        return { allowed: false, reason: 'Rate limit exceeded' };
      }

      const daysSinceFirstUse = (now - stats.firstUsed) / (24 * 60 * 60 * 1000);
      if (daysSinceFirstUse < 1 && stats.usageCount > 1000) {
        console.warn(`[Token Security] Suspicious usage pattern for token: ${token.substring(0, 16)}...`);
        return { allowed: false, reason: 'Suspicious usage pattern' };
      }
    }

    if (clientIp) {
    }

    return { allowed: true };

  } catch (error) {
    console.error('[Token Security] Security validation error:', error);
    return { allowed: false, reason: 'Security validation failed' };
  }
}

/**
 * @returns {Promise<{allowed: boolean, reason?: string, currentCount?: number}>} - ?앹꽦 ?덉슜 ?щ?
 */
async function checkTokenGenerationLimit(channelId) {
  try {
    if (!channelId) {
      return { allowed: false, reason: 'Invalid channel ID' };
    }

    const tokenSet = channelTokensByChannel.get(channelId);
    const currentCount = tokenSet ? tokenSet.size : 0;
    const maxTokensPerChannel = 50;

    if (currentCount >= maxTokensPerChannel) {
      console.warn(`[Token Generation] Token limit reached for channel: ${channelId} (${currentCount}/${maxTokensPerChannel})`);
      return {
        allowed: false,
        reason: 'Token generation limit exceeded',
        currentCount
      };
    }

    const now = Date.now();
    const recentThreshold = 60 * 1000;
    let recentCount = 0;

    if (tokenSet) {
      for (const token of tokenSet) {
        const mapping = channelTokenMapping.get(token);
        if (mapping && (now - mapping.createdAt < recentThreshold)) {
          recentCount++;
        }
      }
    }

    const maxRecentTokens = 5;
    if (recentCount >= maxRecentTokens) {
      console.warn(`[Token Generation] Recent generation limit exceeded for channel: ${channelId} (${recentCount}/${maxRecentTokens})`);
      return {
        allowed: false,
        reason: 'Recent generation limit exceeded',
        currentCount
      };
    }

    return { allowed: true, currentCount };

  } catch (error) {
    console.error('[Token Generation] Limit check error:', error);
    return { allowed: false, reason: 'Limit check failed' };
  }
}

/**
 */
async function verifyTokenIntegrity(token, expectedChannelId = null) {
  try {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Invalid token format' };
    }

    const patterns = {
      roulette: /^rlt_([a-f0-9]{8})_([a-z0-9]+)_([a-z0-9]+)$/,
      pvd: /^pvd_([a-f0-9]{8})_([a-z0-9]+)_([a-z0-9]+)$/
    };

    let tokenType = null;
    let match = null;

    if (patterns.roulette.test(token)) {
      tokenType = 'roulette';
      match = token.match(patterns.roulette);
    } else if (patterns.pvd.test(token)) {
      tokenType = 'pvd';
      match = token.match(patterns.pvd);
    } else if (token.startsWith('rlt_')) {
      tokenType = 'roulette';
    } else if (token.startsWith('pvd_')) {
      tokenType = 'pvd';
    } else {
      return { valid: false, error: 'Unknown token type' };
    }

    const channelId = expectedChannelId || await getChannelIdFromToken(token, tokenType, false);
    if (!channelId) {
      return { valid: false, error: 'Channel ID not found' };
    }

    if (!match) {
      return { valid: true, channelId, persistentToken: true };
    }

    const [, channelHash, timestamp, randomPart] = match;

    const expectedHash = crypto.createHash('sha256')
      .update(channelId + (process.env.TOKEN_SECRET || 'default_secret'))
      .digest('hex')
      .slice(0, 8);

    if (channelHash !== expectedHash) {
      return { valid: false, error: 'Hash verification failed' };
    }

    const tokenTime = parseInt(timestamp, 36);
    if (isNaN(tokenTime) || tokenTime <= 0) {
      return { valid: false, error: 'Invalid timestamp' };
    }

    return { valid: true, channelId, persistentToken: false };

  } catch (error) {
    console.error('[Token Integrity] Verification error:', error);
    return { valid: false, error: 'Integrity verification failed' };
  }
}

function getSessionCacheStats() {
  const now = Date.now();
  const stats = {
    totalEntries: sessionContextCache.size,
    activeEntries: 0,
    expiredEntries: 0,
    entries: []
  };

  for (const [key, context] of sessionContextCache.entries()) {
    const age = now - context.lastActivity;
    const isExpired = age > CACHE_TTL;

    if (isExpired) {
      stats.expiredEntries++;
    } else {
      stats.activeEntries++;
    }

    stats.entries.push({
      key: key.substring(0, 20) + '...',
      channelId: context.channelId,
      userId: context.userId?.substring(0, 10) + '...',
      age: Math.floor(age / 1000),
      expired: isExpired
    });
  }

  return stats;
}

// =============================
// =============================

class ChannelAccessError extends Error {
  constructor(message, channelId, requestedChannelId, userId, errorCode = 'CHANNEL_ACCESS_DENIED') {
    super(message);
    this.name = 'ChannelAccessError';
    this.channelId = channelId;
    this.requestedChannelId = requestedChannelId;
    this.userId = userId;
    this.errorCode = errorCode;
    this.timestamp = new Date().toISOString();
  }

  getUserFriendlyMessage() {
    switch (this.errorCode) {
      case 'CHANNEL_ACCESS_DENIED':
        return '다른 방송 채널의 데이터에 접근할 수 없습니다. 현재 로그인된 채널의 설정만 관리할 수 있습니다.';
      case 'INVALID_CHANNEL_CONTEXT':
        return '채널 정보를 찾을 수 없습니다. 다시 로그인해 주세요.';
      case 'CHANNEL_NOT_FOUND':
        return '요청한 채널을 찾을 수 없습니다.';
      case 'INSUFFICIENT_CHANNEL_PERMISSIONS':
        return '해당 채널에 대한 권한이 없습니다.';
      default:
        return '채널 접근 중 오류가 발생했습니다.';
    }
  }

  getLogDetails() {
    return {
      errorCode: this.errorCode,
      message: this.message,
      channelId: this.channelId,
      requestedChannelId: this.requestedChannelId,
      userId: this.userId,
      timestamp: this.timestamp
    };
  }
}

async function enforceChannelAccess(req, res, next) {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      console.warn('[ChannelAccess] Authentication required:', {
        path: req.path,
        method: req.method,
        ip: req.ip
      });
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      console.warn('[ChannelAccess] Invalid session context:', {
        sid,
        path: req.path,
        method: req.method
      });
      return res.status(403).json({
        error: 'Invalid session context',
        code: 'INVALID_SESSION'
      });
    }

    const requestedChannelId = req.params.channelId ||
      req.body.channelId ||
      req.query.channelId ||
      req.headers['x-channel-id'];

    if (requestedChannelId) {
      if (requestedChannelId !== channelContext.channelId) {
        const error = new ChannelAccessError(
          'Channel access denied',
          channelContext.channelId,
          requestedChannelId,
          channelContext.userId,
          'CHANNEL_ACCESS_DENIED'
        );

        const logContext = {
          userId: channelContext.userId,
          currentChannel: channelContext.channelId,
          requestedChannel: requestedChannelId,
          path: req.path,
          method: req.method,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          timestamp: error.timestamp,
          sessionId: req.sessionID || 'unknown'
        };

        console.warn('[ChannelAccess] Cross-channel access attempt:', logContext);
        logChannelAccessDenied(logContext);

        logSecurityEvent(SECURITY_EVENT_TYPES.CROSS_CHANNEL_ATTEMPT, {
          userId: channelContext.userId,
          currentChannelId: channelContext.channelId,
          requestedChannelId: requestedChannelId,
          path: req.path,
          method: req.method,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          sessionId: req.sessionID || 'unknown'
        });

        monitorSuspiciousActivity(channelContext.userId, req.ip, 'CROSS_CHANNEL_ATTEMPT', {
          currentChannelId: channelContext.channelId,
          requestedChannelId: requestedChannelId,
          path: req.path,
          method: req.method
        });

        return res.status(403).json({
          error: error.getUserFriendlyMessage(),
          code: error.errorCode,
          details: {
            currentChannel: channelContext.channelId,
            requestedChannel: requestedChannelId,
            timestamp: error.timestamp
          }
        });
      }
    }

    req.channelContext = channelContext;
    req.sid = sid;

    channelContext.lastActivity = Date.now();

    console.log('[ChannelAccess] Access granted:', {
      channelId: channelContext.channelId,
      userId: channelContext.userId,
      path: req.path,
      method: req.method
    });

    next();

  } catch (error) {
    console.error('[ChannelAccess] Middleware error:', error);

    if (error instanceof ChannelAccessError) {
      return res.status(403).json({
        error: error.message,
        code: 'CHANNEL_ACCESS_DENIED',
        details: {
          currentChannel: error.channelId,
          requestedChannel: error.requestedChannelId
        }
      });
    }

    return res.status(500).json({
      error: 'Channel validation failed',
      code: 'CHANNEL_VALIDATION_ERROR'
    });
  }
}

async function optionalChannelAccess(req, res, next) {
  try {
    const sid = await getPartitionId(req, res);
    if (sid) {
      const channelContext = await getChannelContext(sid);
      if (channelContext) {
        req.channelContext = channelContext;
        req.sid = sid;

        const requestedChannelId = req.params.channelId ||
          req.body.channelId ||
          req.query.channelId ||
          req.headers['x-channel-id'];

        if (requestedChannelId && requestedChannelId !== channelContext.channelId) {
          console.warn('[ChannelAccess] Optional access denied:', {
            currentChannel: channelContext.channelId,
            requestedChannel: requestedChannelId,
            path: req.path
          });

          return res.status(403).json({
            error: 'Channel access denied',
            code: 'CHANNEL_ACCESS_DENIED'
          });
        }

        channelContext.lastActivity = Date.now();
      }
    }

    next();
  } catch (error) {
    console.error('[ChannelAccess] Optional middleware error:', error);
    next();
  }
}

const channelAccessStats = {
  totalRequests: 0,
  deniedRequests: 0,
  crossChannelAttempts: 0,
  suspiciousPatterns: 0,
  lastDeniedAttempts: [],
  userAttemptCounts: new Map(),
  ipAttemptCounts: new Map(),
  startTime: new Date().toISOString()
};

function detectSuspiciousPattern(context) {
  const userId = context.userId;
  const ip = context.ip;
  const now = Date.now();

  if (!channelAccessStats.userAttemptCounts.has(userId)) {
    channelAccessStats.userAttemptCounts.set(userId, []);
  }

  const userAttempts = channelAccessStats.userAttemptCounts.get(userId);
  userAttempts.push(now);

  const fiveMinutesAgo = now - (5 * 60 * 1000);
  const recentUserAttempts = userAttempts.filter(time => time > fiveMinutesAgo);
  channelAccessStats.userAttemptCounts.set(userId, recentUserAttempts);

  if (!channelAccessStats.ipAttemptCounts.has(ip)) {
    channelAccessStats.ipAttemptCounts.set(ip, []);
  }

  const ipAttempts = channelAccessStats.ipAttemptCounts.get(ip);
  ipAttempts.push(now);

  const recentIpAttempts = ipAttempts.filter(time => time > fiveMinutesAgo);
  channelAccessStats.ipAttemptCounts.set(ip, recentIpAttempts);

  //
  let isSuspicious = false;

  if (recentUserAttempts.length >= 5) {
    isSuspicious = true;
    console.error('[Security Alert] Suspicious user activity detected:', {
      userId,
      attempts: recentUserAttempts.length,
      timeWindow: '5 minutes'
    });
  }

  if (recentIpAttempts.length >= 10) {
    isSuspicious = true;
    console.error('[Security Alert] Suspicious IP activity detected:', {
      ip,
      attempts: recentIpAttempts.length,
      timeWindow: '5 minutes'
    });
  }

  if (isSuspicious) {
    channelAccessStats.suspiciousPatterns++;
  }

  return isSuspicious;
}

function logChannelAccessDenied(context) {
  channelAccessStats.totalRequests++;
  channelAccessStats.deniedRequests++;
  channelAccessStats.crossChannelAttempts++;

  //
  const isSuspicious = detectSuspiciousPattern(context);

  const logEntry = {
    timestamp: context.timestamp || new Date().toISOString(),
    userId: context.userId,
    currentChannel: context.currentChannel,
    requestedChannel: context.requestedChannel,
    path: context.path,
    method: context.method,
    ip: context.ip,
    userAgent: context.userAgent,
    sessionId: context.sessionId,
    suspicious: isSuspicious,
    severity: isSuspicious ? 'HIGH' : 'MEDIUM'
  };

  channelAccessStats.lastDeniedAttempts.unshift(logEntry);
  if (channelAccessStats.lastDeniedAttempts.length > 20) {
    channelAccessStats.lastDeniedAttempts.pop();
  }

  if (isSuspicious) {
    console.error('[Security Alert] Suspicious channel access denied:', logEntry);
  } else {
    console.warn('[Security] Channel access denied:', logEntry);
  }
}

function getChannelAccessStats() {
  return {
    ...channelAccessStats,
    userAttemptCounts: Object.fromEntries(channelAccessStats.userAttemptCounts),
    ipAttemptCounts: Object.fromEntries(channelAccessStats.ipAttemptCounts),
    timestamp: new Date().toISOString(),
    uptime: Date.now() - new Date(channelAccessStats.startTime).getTime()
  };
}

function resetChannelAccessStats() {
  channelAccessStats.totalRequests = 0;
  channelAccessStats.deniedRequests = 0;
  channelAccessStats.crossChannelAttempts = 0;
  channelAccessStats.suspiciousPatterns = 0;
  channelAccessStats.lastDeniedAttempts = [];
  channelAccessStats.userAttemptCounts.clear();
  channelAccessStats.ipAttemptCounts.clear();
  channelAccessStats.startTime = new Date().toISOString();

  console.log('[Security] Channel access statistics reset');
}

// =============================
// =============================

const SECURITY_EVENT_TYPES = {
  CHANNEL_ACCESS_DENIED: 'channel_access_denied',
  TOKEN_MISUSE: 'token_misuse',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  INVALID_TOKEN_USAGE: 'invalid_token_usage',
  CROSS_CHANNEL_ATTEMPT: 'cross_channel_attempt',
  WEBSOCKET_ABUSE: 'websocket_abuse',
  API_ABUSE: 'api_abuse',
  AUTHENTICATION_FAILURE: 'authentication_failure',
  PERMISSION_ESCALATION: 'permission_escalation'
};

const securityEventLog = {
  events: [],
  maxEvents: 1000,
  tokenUsageTracking: new Map(), // token -> { usageCount, lastUsed, channels: Set, ips: Set }
  suspiciousTokens: new Set(),
  blockedIps: new Set(),
  alertThresholds: {
    tokenUsagePerHour: 100,
    crossChannelAttempts: 5,
    invalidTokenAttempts: 10,
    suspiciousActivityScore: 50
  }
};

function logSecurityEvent(eventType, details) {
  const event = {
    id: crypto.randomUUID(),
    type: eventType,
    timestamp: new Date().toISOString(),
    severity: getSeverityLevel(eventType, details),
    details: {
      ...details,
      instanceId: INSTANCE_ID
    }
  };

  securityEventLog.events.unshift(event);
  if (securityEventLog.events.length > securityEventLog.maxEvents) {
    securityEventLog.events.pop();
  }

  switch (event.severity) {
    case 'CRITICAL':
      console.error('[Security Alert - CRITICAL]', event);
      break;
    case 'HIGH':
      console.error('[Security Alert - HIGH]', event);
      break;
    case 'MEDIUM':
      console.warn('[Security Alert - MEDIUM]', event);
      break;
    case 'LOW':
      console.log('[Security Alert - LOW]', event);
      break;
    default:
      console.log('[Security Event]', event);
  }

  triggerSecurityAlert(event);

  return event;
}

function getSeverityLevel(eventType, details) {
  switch (eventType) {
    case SECURITY_EVENT_TYPES.PERMISSION_ESCALATION:
    case SECURITY_EVENT_TYPES.API_ABUSE:
      return 'CRITICAL';

    case SECURITY_EVENT_TYPES.SUSPICIOUS_ACTIVITY:
    case SECURITY_EVENT_TYPES.WEBSOCKET_ABUSE:
    case SECURITY_EVENT_TYPES.TOKEN_MISUSE:
      return 'HIGH';

    case SECURITY_EVENT_TYPES.CROSS_CHANNEL_ATTEMPT:
    case SECURITY_EVENT_TYPES.RATE_LIMIT_EXCEEDED:
      return 'MEDIUM';

    case SECURITY_EVENT_TYPES.CHANNEL_ACCESS_DENIED:
    case SECURITY_EVENT_TYPES.INVALID_TOKEN_USAGE:
    case SECURITY_EVENT_TYPES.AUTHENTICATION_FAILURE:
      return 'LOW';

    default:
      return 'INFO';
  }
}

function getCookieOptions({ maxAge } = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieDomain = String(process.env.COOKIE_DOMAIN || '').trim();
  const secure = process.env.COOKIE_SECURE
    ? String(process.env.COOKIE_SECURE).toLowerCase() !== 'false'
    : isProduction;
  const requestedSameSite = String(process.env.COOKIE_SAME_SITE || 'lax').trim().toLowerCase();
  const sameSite = ['strict', 'lax', 'none'].includes(requestedSameSite) ? requestedSameSite : 'lax';

  const cookieOptions = {
    httpOnly: true,
    sameSite,
    secure,
  };

  if (sameSite === 'none') {
    cookieOptions.secure = true;
  }

  if (maxAge) cookieOptions.maxAge = maxAge;
  if (cookieDomain) cookieOptions.domain = cookieDomain;
  return cookieOptions;
}

function setCookieSid(res, sid) {
  res.cookie('sid', sid, getCookieOptions({ maxAge: 30 * 24 * 60 * 60 * 1000 }));
}

function setOAuthStateCookie(res, name, state) {
  res.cookie(name, state, getCookieOptions({ maxAge: 10 * 60 * 1000 }));
}

function clearManagedCookie(res, name) {
  res.clearCookie(name, getCookieOptions());
  // Older deployments defaulted to .yuaru.kr, which breaks yuaru.com callbacks.
  // Clear both legacy and current common domains during auth/logout cleanup.
  for (const legacyDomain of ['.yuaru.kr', '.yuaru.com']) {
    res.clearCookie(name, { ...getCookieOptions(), domain: legacyDomain });
  }
}

function getAuthRedirectUrl(req, params = {}) {
  const appRedirect = process.env.APP_REDIRECT_AFTER_LOGIN || '/?auth=success';
  const base = `${req.protocol}://${req.get('host')}`;
  const redirectUrl = new URL(appRedirect, base);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') {
      redirectUrl.searchParams.delete(key);
    } else {
      redirectUrl.searchParams.set(key, String(value));
    }
  }
  return redirectUrl.toString();
}

function getSafeFrontendReturnTo(req, rawReturnTo) {
  const raw = String(rawReturnTo || '').trim();
  if (!raw) return null;
  const frontendOrigin = FRONTEND_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_REDIRECT_AFTER_LOGIN || `${req.protocol}://${req.get('host')}`;
  try {
    const frontend = new URL(frontendOrigin);
    const url = new URL(raw, frontend);
    if (url.origin !== frontend.origin) return null;
    const allowedPaths = ['/viewer/', '/c/', '/connection'];
    const allowed = allowedPaths.some((path) => url.pathname === path || url.pathname.startsWith(path.endsWith('/') ? path : `${path}/`));
    if (!allowed) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function getAuthRedirectUrlWithState(req, stateValidation, params = {}) {
  const returnTo = getSafeFrontendReturnTo(req, stateValidation?.extra?.returnTo);
  if (!returnTo) return getAuthRedirectUrl(req, params);
  const base = FRONTEND_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || `${req.protocol}://${req.get('host')}`;
  const redirectUrl = new URL(returnTo, base);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') redirectUrl.searchParams.delete(key);
    else redirectUrl.searchParams.set(key, String(value));
  }
  return redirectUrl.toString();
}

function getArubotAdminRedirectUrl(req, params = {}) {
  const base = FRONTEND_ORIGIN || process.env.APP_REDIRECT_AFTER_LOGIN || `${req.protocol}://${req.get('host')}`;
  const redirectUrl = new URL('/arubot-admin', base);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') redirectUrl.searchParams.delete(key);
    else redirectUrl.searchParams.set(key, String(value));
  }
  return redirectUrl.toString();
}

function getSameOriginReturnUrl(req, rawReturnTo) {
  const raw = String(rawReturnTo || '').trim();
  if (!raw) return null;
  const requestOrigin = `${req.protocol}://${req.get('host')}`;
  const url = new URL(raw, requestOrigin);
  if (url.origin !== requestOrigin) return null;
  return url;
}

const oauthStateStore = new Map();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function getOAuthStateSecret() {
  return String(
    process.env.OAUTH_STATE_SECRET ||
    process.env.SESSION_SECRET ||
    CHZZK_CLIENT_SECRET ||
    CIME_CLIENT_SECRET ||
    YOUTUBE_CLIENT_SECRET ||
    'arubot-oauth-state-development-secret'
  );
}

function signOAuthState(provider, nonce, tsHex) {
  return crypto
    .createHmac('sha256', getOAuthStateSecret())
    .update(`${provider}:${nonce}:${tsHex}`)
    .digest('hex')
    .slice(0, 32);
}

function createSignedOAuthState(provider) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const tsHex = Date.now().toString(16).padStart(12, '0');
  const signature = signOAuthState(provider, nonce, tsHex);
  return `${nonce}${tsHex}${signature}`;
}

function verifySignedOAuthState(provider, state) {
  const text = String(state || '');
  if (!/^[a-f0-9]{76}$/i.test(text)) {
    return { ok: false, reason: 'format' };
  }
  const nonce = text.slice(0, 32);
  const tsHex = text.slice(32, 44);
  const signature = text.slice(44, 76).toLowerCase();
  const issuedAt = Number.parseInt(tsHex, 16);
  if (!Number.isFinite(issuedAt)) {
    return { ok: false, reason: 'timestamp' };
  }
  const age = Date.now() - issuedAt;
  if (age < -60 * 1000 || age > OAUTH_STATE_TTL_MS) {
    return { ok: false, reason: 'expired', age };
  }
  const expected = signOAuthState(provider, nonce, tsHex);
  const ok = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  return { ok, reason: ok ? null : 'signature', age };
}

function cleanupOAuthStateStore() {
  const now = Date.now();
  for (const [state, record] of oauthStateStore.entries()) {
    if (!record || now - Number(record.createdAt || 0) > OAUTH_STATE_TTL_MS) {
      oauthStateStore.delete(state);
    }
  }
}

function createOAuthState(provider, req, extra = {}) {
  cleanupOAuthStateStore();
  const state = createSignedOAuthState(provider);
  oauthStateStore.set(state, {
    provider: String(provider || ''),
    createdAt: Date.now(),
    sid: getCookieSid(req) || null,
    extra: extra && typeof extra === 'object' ? { ...extra } : {},
  });
  return state;
}

function consumeOAuthState(provider, state, cookieState) {
  cleanupOAuthStateStore();
  const textState = String(state || '');
  const textCookieState = String(cookieState || '');
  const record = textState ? oauthStateStore.get(textState) : null;
  const providerMatches = !!record && record.provider === provider;
  const ageOk = !!record && Date.now() - Number(record.createdAt || 0) <= OAUTH_STATE_TTL_MS;
  const cookieMatches = !!textState && !!textCookieState && textState === textCookieState;
  const storeMatches = !!textState && providerMatches && ageOk;
  const signedState = verifySignedOAuthState(provider, textState);
  const signedMatches = signedState.ok;

  if (storeMatches) oauthStateStore.delete(textState);

  const signedCookieMatches = signedMatches && cookieMatches;

  return {
    ok: storeMatches || signedCookieMatches,
    record: storeMatches ? record : null,
    extra: storeMatches ? (record.extra || {}) : {},
    cookieMatches,
    storeMatches,
    signedMatches: signedCookieMatches,
    signedStateReason: signedState.reason,
    storeFound: !!record,
    providerMatches,
    ageOk,
  };
}

// --- API Key management endpoints (registered after app init) ---
// Issue a new API key for the logged-in user (cookie session required)
app.post('/api/apikey/issue', async (req, res) => {
  try {
    console.log('[apikey:issue] Request received');
    const sidToken = getCookieSid(req);
    console.log('[apikey:issue] sidToken:', sidToken ? 'present' : 'missing');
    if (!sidToken) return res.status(401).json({ error: 'Login required' });
    const userId = await getSessionUserId(sidToken);
    console.log('[apikey:issue] userId:', userId ? 'present' : 'missing');
    if (!userId) return res.status(401).json({ error: 'Login required' });
    const pid = `user:${String(userId)}`;
    const rotateStr = String((req.query.rotate ?? req.body?.rotate ?? '')).toLowerCase();
    const rotate = rotateStr === '1' || rotateStr === 'true' || rotateStr === 'yes' || rotateStr === 'on';
    if (!rotate) {
      try {
        const existing = await getActiveApiKeyForOwner(pid);
        if (existing) return res.json({ apiKey: existing, reused: true });
      } catch { }
    }
    if (rotate) {
      try { await revokeAllApiKeysForOwner(pid); } catch { }
    }
    const key = await issueApiKey(pid);
    return res.json({ apiKey: key, reused: false, rotated: !!rotate });
  } catch (e) {
    console.error('[apikey:issue] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to issue API key' });
  }
});

// Revoke an API key (cookie session required)
app.post('/api/apikey/revoke', async (req, res) => {
  try {
    const sidToken = getCookieSid(req);
    if (!sidToken) return res.status(401).json({ error: 'Login required' });
    const userId = await getSessionUserId(sidToken);
    if (!userId) return res.status(401).json({ error: 'Login required' });
    const { apiKey } = req.body || {};
    if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });
    await revokeApiKey(`user:${String(userId)}`, String(apiKey));
    return res.json({ ok: true });
  } catch (e) {
    console.error('[apikey:revoke] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// Helper page: issue a key then redirect with ?apiKey=...
app.get('/apikey', async (req, res) => {
  try {
    const sidToken = getCookieSid(req);
    if (!sidToken) return res.status(401).send('<h3>Login required</h3>');
    const userId = await getSessionUserId(sidToken);
    if (!userId) return res.status(401).send('<h3>Login required</h3>');
    const pid = `user:${String(userId)}`;
    const rotateStr = String(req.query.rotate ?? '').toLowerCase();
    const rotate = rotateStr === '1' || rotateStr === 'true' || rotateStr === 'yes' || rotateStr === 'on';
    let key = null;
    if (!rotate) {
      try { key = await getActiveApiKeyForOwner(pid); } catch { }
    }
    if (!key) {
      if (rotate) { try { await revokeAllApiKeysForOwner(pid); } catch { } }
      key = await issueApiKey(pid);
    }
    const returnTo = String(req.query.return_to || req.query.returnTo || '');
    if (returnTo) {
      try {
        const url = getSameOriginReturnUrl(req, returnTo);
        if (url) {
          url.searchParams.set('apiKey', key);
          res.writeHead(302, { Location: url.toString() });
          return res.end();
        }
      } catch { }
    }
    return res.send(`<html><body><h3>API Key Issued</h3><code>${key}</code></body></html>`);
  } catch (e) {
    console.error('[apikey:page] error', e?.message || e);
    return res.status(500).send('Failed to issue API key');
  }
});

// Resolve partition id (pid) used for DB: prefer user:<userId> when logged-in, else sid:<cookieSid>
async function getPartitionId(req, res) {
  // 1) API Key takes precedence if provided
  const byKey = await getPartitionIdByApiKey(req);
  if (byKey) {
    try {
      const userId = byKey.startsWith('user:') ? byKey.slice(5) : byKey;
      const channelId = await resolveChannelIdForOwnerUserId(userId, { provider: 'chzzk' });

      if (channelId) {
        const cacheKey = `api:${byKey}`;
        const context = {
          sid: byKey,
          channelId,
          userId,
          lastActivity: Date.now(),
          sessionKey: null,
          isolationLevel: 'strict',
          connectionId: `api_${Date.now()}_${Math.random().toString(36).slice(2)}`
        };

        channelCache.set(channelId, cacheKey, context, CACHE_TTL);
        console.log(`[Session] API key access - channelId: ${channelId}, userId: ${userId}`);
      }
    } catch (error) {
      console.error('[Session] Failed to create API key context:', error);
    }

    return byKey;
  }

  const sidToken = getCookieSid(req);
  if (!sidToken) return null;

  const legacyCachedContext = sessionContextCache.get(sidToken);
  if (legacyCachedContext && (Date.now() - legacyCachedContext.lastActivity) < CACHE_TTL) {
    const cacheKey = `session:${sidToken}`;
    legacyCachedContext.lastActivity = Date.now();
    channelCache.set(legacyCachedContext.channelId, cacheKey, legacyCachedContext, CACHE_TTL);
    sessionContextCache.delete(sidToken);
    console.log(`[Session] Legacy cache migrated - channelId: ${legacyCachedContext.channelId}, userId: ${legacyCachedContext.userId}`);
    return legacyCachedContext.sid;
  }

  try {
    const userId = await getSessionUserId(sidToken);
    if (userId) {
      const channelId = await resolveChannelIdForOwnerUserId(userId, { provider: 'chzzk' });
      const sid = `user:${String(userId)}`;

      if (!channelId) {
        console.warn('[Session] Channel ID validation failed for userId:', userId);
        return null;
      }

      const sessionContext = {
        sid,
        channelId,
        userId: String(userId),
        lastActivity: Date.now(),
        sessionKey: null,
        isolationLevel: 'strict',
        connectionId: `session_${Date.now()}_${Math.random().toString(36).slice(2)}`
      };

      const cacheKey = `session:${sidToken}`;
      channelCache.set(channelId, cacheKey, sessionContext, CACHE_TTL);

      return sid;
    }

    // No session mapping yet: try to bootstrap using temp tokens under sid:<cookieSid>
    const tempPid = `sid:${sidToken}`;
    const tokens = await getTokens(tempPid);
    if (tokens) {
      try {
        const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
          headers: { Authorization: `${tokens.tokenType || 'Bearer'} ${tokens.accessToken}` }
        });
        const content = me?.data?.content || me?.data || {};
        if (content?.channelId) {
          const uid = String(content.channelId);
          const channelId = getChannelIdFromUserId(uid);

          if (!channelId) {
            console.warn('[SessionBootstrap] Channel ID validation failed for uid:', uid);
            return null;
          }

          try { await migrateSidToUserPid(sidToken, uid); } catch { }
          try { await upsertSession(sidToken, uid, 30); } catch { }

          const sid = `user:${uid}`;

          const sessionContext = {
            sid,
            channelId,
            userId: uid,
            lastActivity: Date.now(),
            sessionKey: null,
            isolationLevel: 'strict',
            connectionId: `bootstrap_${Date.now()}_${Math.random().toString(36).slice(2)}`
          };

          const cacheKey = `session:${sidToken}`;
          channelCache.set(channelId, cacheKey, sessionContext, CACHE_TTL);
          console.log(`[SessionBootstrap] Context cached - channelId: ${channelId}, userId: ${uid}`);

          return sid;
        }
        console.warn('[SessionBootstrap] users/me returned no userId for cookieSid=', sidToken);
      } catch (error) {
        console.error('[SessionBootstrap] Failed to fetch user info:', error);
      }
    }

    console.warn('[SessionBootstrap] No session and no temp tokens for cookieSid=', sidToken);
  } catch (error) {
    console.error('[Session] getPartitionId error:', error);
  }

  return null;
}

// Helper to compute expiry timestamp
function computeExpiresAt(expiresInSeconds) {
  const buffer = 60; // seconds buffer
  return new Date(Date.now() + (Number(expiresInSeconds || 0) - buffer) * 1000).toISOString();
}

function unwrapOpenApiContent(resp) {
  return (resp?.data && Object.prototype.hasOwnProperty.call(resp.data, 'content')) ? resp.data.content : (resp?.data || {});
}

function normalizeCimeProfile(content) {
  const channelId = String(content?.channelId || '').trim();
  return {
    platformUserId: channelId,
    channelId,
    channelName: content?.channelName ? String(content.channelName) : null,
    channelHandle: content?.channelHandle ? String(content.channelHandle) : null,
    channelImageUrl: content?.channelImageUrl || null,
    metadata: {
      raw: content || {}
    }
  };
}

async function getCurrentSessionUserId(req) {
  const sidToken = getCookieSid(req);
  if (!sidToken) return null;
  try { return await getSessionUserId(sidToken); } catch { return null; }
}

async function getBotRulesOwnerSid(req, res) {
  const byKey = await getPartitionIdByApiKey(req);
  if (byKey) return byKey;
  const ownerUserId = await getCurrentSessionUserId(req);
  if (ownerUserId) return `user:${String(ownerUserId)}`;
  return await getPartitionId(req, res).catch(() => null);
}

async function requireCurrentAdminUser(req, res) {
  const ownerUserId = await getCurrentSessionUserId(req);
  if (!ownerUserId) {
    res.status(401).json({ error: 'Login required' });
    return null;
  }
  const admin = await getAppUserAdminStatus(ownerUserId).catch(() => null);
  if (admin?.isAdmin !== true) {
    res.status(403).json({ error: 'AruBot admin required' });
    return null;
  }
  return { ...admin, userId: ownerUserId };
}

async function getCurrentAdminUserForCallback(req) {
  const ownerUserId = await getCurrentSessionUserId(req);
  if (!ownerUserId) return null;
  const admin = await getAppUserAdminStatus(ownerUserId).catch(() => null);
  return admin?.isAdmin === true ? { ...admin, userId: ownerUserId } : null;
}

const AUTOMATION_SOUND_QUOTA_BYTES = Number(process.env.AUTOMATION_SOUND_QUOTA_BYTES || 10 * 1024 * 1024);
const AUTOMATION_SOUND_MAX_FILE_BYTES = Number(process.env.AUTOMATION_SOUND_MAX_FILE_BYTES || 5 * 1024 * 1024);
const AUTOMATION_USER_FILE_ROOT = process.env.AUTOMATION_USER_FILE_ROOT || path.join(process.cwd(), 'server', 'user-files', 'automation');

function automationOwnerKey(ownerUserId) {
  return crypto.createHash('sha256').update(String(ownerUserId || '')).digest('hex').slice(0, 32);
}

function sanitizeFileBase(name) {
  const clean = String(name || 'sound')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return clean || 'sound';
}

function automationSoundDir(ownerUserId) {
  return path.join(AUTOMATION_USER_FILE_ROOT, automationOwnerKey(ownerUserId), 'sounds');
}

function ensureAutomationSoundDir(ownerUserId) {
  const dir = automationSoundDir(ownerUserId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listAutomationSoundFiles(ownerUserId) {
  const dir = ensureAutomationSoundDir(ownerUserId);
  const rows = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      const stat = fs.statSync(fullPath);
      const encoded = encodeURIComponent(entry.name);
      return {
        id: entry.name,
        name: entry.name.replace(/^[a-z0-9]+_/, ''),
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        url: `/api/automations/assets/sounds/${encoded}`
      };
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return {
    quotaBytes: AUTOMATION_SOUND_QUOTA_BYTES,
    usedBytes: rows.reduce((sum, file) => sum + Number(file.size || 0), 0),
    files: rows
  };
}

const FX_ASSET_KINDS = new Set(['image', 'sticker', 'video', 'sound', 'text', 'tts']);

function listLocalFxAssetsFromConnections(connections = []) {
  const connection = connections.find((item) => item.type === 'fx_assets' && item.enabled !== false);
  const cache = connection?.discoveryCache || connection?.discovery_cache || {};
  const assets = Array.isArray(cache.assets) ? cache.assets : [];
  return {
    connection,
    assets: assets
      .filter((asset) => asset && FX_ASSET_KINDS.has(String(asset.kind || '').toLowerCase()))
      .map((asset) => ({
        id: String(asset.id || asset.fileName || '').trim(),
        name: String(asset.name || asset.fileName || asset.id || '').trim(),
        kind: String(asset.kind || '').toLowerCase(),
        size: Number(asset.size || 0),
        updatedAt: asset.updatedAt || null,
        previewDataUrl: typeof asset.previewDataUrl === 'string' && asset.previewDataUrl.startsWith('data:image/')
          ? asset.previewDataUrl.slice(0, 512 * 1024)
          : null
      }))
      .filter((asset) => asset.id && asset.name)
  };
}

function publicExecutionMode(value) {
  return String(value || '').trim() === 'local_program' ? 'local' : 'web';
}

function internalExecutionMode(value, fallback = 'oracle_direct') {
  const mode = String(value || '').trim();
  if (mode === 'local' || mode === 'local_program') return 'local_program';
  if (mode === 'web' || mode === 'managed' || mode === 'oracle_direct') return 'oracle_direct';
  return fallback;
}

function publicSoundStorageMode(value) {
  return String(value || '').trim() === 'local_program' ? 'local' : 'managed';
}

function internalSoundStorageMode(value) {
  const mode = String(value || '').trim();
  return mode === 'local' || mode === 'local_program' ? 'local_program' : 'server_hosted';
}

function publicTtsProvider(value) {
  return String(value || '').trim() === 'local_program' ? 'local' : 'browser';
}

function internalTtsProvider(value) {
  const provider = String(value || '').trim();
  return provider === 'local' || provider === 'local_program' ? 'local_program' : 'browser';
}

function publicAutomationDiscovery(cache = {}) {
  const source = cache && typeof cache === 'object' ? cache : {};
  const out = {};
  for (const key of ['items', 'triggers', 'hotkeys', 'models', 'expressions', 'currentModel', 'scenes', 'sources', 'filters', 'assets', 'fetchedAt']) {
    if (source[key] != null) out[key] = source[key];
  }
  return out;
}

function publicAutomationConnection(connection = {}) {
  if (!connection) return null;
  return {
    id: connection.id,
    type: connection.type,
    name: connection.name,
    enabled: connection.enabled !== false,
    executionMode: publicExecutionMode(connection.executionMode || connection.execution_mode),
    endpoint: connection.endpoint || '',
    discoveryCache: publicAutomationDiscovery(connection.discoveryCache || connection.discovery_cache || {}),
    lastStatus: connection.lastStatus || connection.last_status || null
  };
}

function publicAutomationAgent(agent = {}) {
  if (!agent) return null;
  return {
    id: agent.id,
    name: agent.name,
    status: agent.status || 'offline',
    lastSeenAt: agent.lastSeenAt || agent.last_seen_at || null
  };
}

function publicAutomationSettings(settings = {}) {
  return {
    integrationMode: publicExecutionMode(settings.integrationMode),
    soundStorageMode: publicSoundStorageMode(settings.soundStorageMode),
    tts: {
      enabled: settings?.tts?.enabled !== false,
      provider: publicTtsProvider(settings?.tts?.provider),
      voice: settings?.tts?.voice || '',
      rate: Number(settings?.tts?.rate || 1),
      pitch: Number(settings?.tts?.pitch || 1)
    }
  };
}

function normalizeFxPercent(value, fallback, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeFxCss(value, fallback = '') {
  return String(value || fallback)
    .replace(/[{}<>]/g, '')
    .slice(0, 240);
}

function normalizeFxCssCode(value) {
  return String(value || '')
    .replace(/<\/?style[^>]*>/gi, '')
    .slice(0, 12000);
}

function normalizeFxColor(value, fallback = '#00ff00') {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

function normalizeFxPayload(input = {}) {
  const kind = String(input.kind || input.type || input.assetKind || 'image').toLowerCase();
  const normalizedKind = FX_ASSET_KINDS.has(kind) ? kind : 'image';
  return {
    id: String(input.id || `fx_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`),
    kind: normalizedKind,
    assetId: path.basename(String(input.assetId || input.fileId || input.name || '')),
    assetName: String(input.assetName || input.fileName || input.name || '').slice(0, 120),
    assetUrl: typeof input.assetUrl === 'string' ? input.assetUrl.slice(0, 4096) : '',
    youtubeUrl: typeof input.youtubeUrl === 'string' ? input.youtubeUrl.slice(0, 2048) : '',
    text: typeof input.text === 'string' ? input.text.slice(0, 500) : '',
    overlayId: typeof input.overlayId === 'string' ? input.overlayId.slice(0, 120) : '',
    animation: typeof input.animation === 'string' ? input.animation.slice(0, 240) : '',
    animationKey: typeof input.animationKey === 'string' ? input.animationKey.slice(0, 120) : '',
    cssCode: normalizeFxCssCode(input.cssCode),
    voice: typeof input.voice === 'string' ? input.voice.slice(0, 120) : '',
    rate: Math.min(2, Math.max(0.5, Number(input.rate || 1))),
    pitch: Math.min(2, Math.max(0.5, Number(input.pitch || 1))),
    x: normalizeFxPercent(input.x ?? input.left, 50),
    y: normalizeFxPercent(input.y ?? input.top, 50),
    width: normalizeFxPercent(input.width, normalizedKind === 'sound' || normalizedKind === 'tts' ? 0 : normalizedKind === 'text' ? 46 : 30, 1, 100),
    height: normalizeFxPercent(input.height, normalizedKind === 'sound' || normalizedKind === 'tts' ? 0 : normalizedKind === 'text' ? 16 : 30, 1, 100),
    durationMs: Math.max(250, Math.min(60000, Number(input.durationMs ?? Number(input.durationSec || 4) * 1000) || 4000)),
    enterCss: normalizeFxCss(input.enterCss),
    exitCss: normalizeFxCss(input.exitCss),
    chromaKey: input.chromaKey === true,
    chromaKeyColor: normalizeFxColor(input.chromaKeyColor),
    chromaKeyTolerance: Math.max(0, Math.min(160, Number(input.chromaKeyTolerance ?? 42) || 42)),
    volume: Math.max(0, Math.min(1, Number(input.volume ?? 1) || 0)),
    createdAt: new Date().toISOString()
  };
}

function broadcastFxEventToSid(sid, type, payload) {
  const key = String(sid || '').trim();
  const sockets = fxSidSockets?.get(key);
  if (!sockets?.size) return 0;
  const event = { type, sid: key, payload: normalizeFxPayload(payload), serverNow: Date.now() };
  let sent = 0;
  for (const ws of Array.from(sockets)) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event), { compress: false });
        sent += 1;
      } else {
        sockets.delete(ws);
      }
    } catch {
      try { sockets.delete(ws); } catch { }
    }
  }
  if (sockets.size === 0) fxSidSockets.delete(key);
  return sent;
}

function broadcastFxToSid(sid, payload) {
  return broadcastFxEventToSid(sid, 'fx:play', payload);
}

function pickYoutubeThumbnail(thumbnails = {}) {
  const candidates = [thumbnails.high, thumbnails.medium, thumbnails.default].filter(Boolean);
  return candidates.find((item) => item?.url)?.url || null;
}

function normalizeYoutubeProfile(channel) {
  const snippet = channel?.snippet || {};
  const channelId = String(channel?.id || snippet.channelId || '').trim();
  const customUrl = snippet.customUrl ? String(snippet.customUrl) : null;
  return {
    platformUserId: channelId,
    channelId,
    channelName: snippet.title ? String(snippet.title) : null,
    channelHandle: customUrl,
    channelImageUrl: pickYoutubeThumbnail(snippet.thumbnails),
    metadata: {
      raw: channel || {},
      publicProfile: {
        provider: 'youtube',
        status: channelId ? 'ok' : 'skipped',
        channelId,
        description: snippet.description || null,
        fetchedAt: new Date().toISOString()
      }
    }
  };
}

function normalizeGoogleTokenPayload(payload, previousTokens = {}, fallbackScope = YOUTUBE_BOT_AUTH_SCOPE) {
  const expiresIn = Number(payload?.expires_in || payload?.expiresIn || 3600);
  return {
    accessToken: payload?.access_token || payload?.accessToken || previousTokens.accessToken || null,
    refreshToken: payload?.refresh_token || payload?.refreshToken || previousTokens.refreshToken || null,
    tokenType: payload?.token_type || payload?.tokenType || previousTokens.tokenType || 'Bearer',
    expiresAt: computeExpiresAt(Number.isFinite(expiresIn) ? expiresIn : 3600),
    scope: payload?.scope || previousTokens.scope || fallbackScope
  };
}

function getTitsEndpoint(endpoint, kind = 'data') {
  const raw = String(endpoint || '').trim() || 'ws://localhost:42069';
  const base = raw.endsWith('/websocket') || raw.endsWith('/events') ? raw.replace(/\/(websocket|events)$/, '') : raw.replace(/\/$/, '');
  return `${base}/${kind === 'events' ? 'events' : 'websocket'}`;
}

function makeTitsMessage(messageType, data = {}) {
  return {
    apiName: 'TITSPublicApi',
    apiVersion: '1.0',
    requestID: `arubot_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    messageType,
    ...(Object.keys(data || {}).length ? { data } : {})
  };
}

function parseIpv4MappedIpv6(value) {
  const match = String(value || '').toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (!match || net.isIP(match[1]) !== 4) return null;
  return match[1];
}

function isPrivateIpAddress(value) {
  const mapped = parseIpv4MappedIpv6(value);
  if (mapped) return isPrivateIpAddress(mapped);
  if (net.isIP(value) === 4) {
    const [a, b] = String(value).split('.').map((part) => Number(part));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIP(value) === 6) {
    const normalized = String(value).toLowerCase();
    return normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb');
  }
  return false;
}

function isCloudMetadataAddress(value) {
  const mapped = parseIpv4MappedIpv6(value);
  if (mapped) return isCloudMetadataAddress(mapped);
  if (net.isIP(value) === 4) return String(value) === OCI_METADATA_IPV4;
  return false;
}

async function assertSafeServerAutomationWebSocketUrl(rawEndpoint) {
  const url = new URL(getVtubeEndpoint(rawEndpoint));
  if (!['wss:', 'ws:'].includes(url.protocol)) {
    throw new Error('Automation endpoint must be a ws/wss URL');
  }

  const allowPrivateNetwork = process.env.ARUBOT_ALLOW_SERVER_PRIVATE_AUTOMATION === 'true';
  const allowInsecure = process.env.ARUBOT_ALLOW_INSECURE_SERVER_AUTOMATION_WS === 'true' || process.env.NODE_ENV !== 'production';
  if (url.protocol === 'ws:' && !allowInsecure) {
    throw new Error('Server-side automation endpoints must use WSS in production');
  }

  const hostname = url.hostname;
  const lowerHost = hostname.toLowerCase();
  if (isCloudMetadataAddress(hostname)) {
    throw new Error(`Server-side automation endpoints cannot target OCI internal DNS/metadata address ${OCI_METADATA_IPV4}`);
  }
  const resolvedRecords = !net.isIP(hostname)
    ? await dns.promises.lookup(hostname, { all: true, verbatim: true })
    : [];
  if (resolvedRecords.some((record) => isCloudMetadataAddress(record.address))) {
    throw new Error(`Server-side automation endpoint resolves to OCI internal DNS/metadata address ${OCI_METADATA_IPV4}`);
  }
  if (!allowPrivateNetwork && (
    lowerHost === 'localhost' ||
    lowerHost.endsWith('.localhost') ||
    isPrivateIpAddress(hostname)
  )) {
    throw new Error('Server-side automation endpoints cannot target localhost or private networks');
  }
  if (!allowPrivateNetwork && !net.isIP(hostname)) {
    if (!resolvedRecords.length || resolvedRecords.some((record) => isPrivateIpAddress(record.address))) {
      throw new Error('Server-side automation endpoint resolves to a private network address');
    }
  }
  return url.href;
}

async function sendTitsRequest(endpoint, messageType, data = {}, timeoutMs = 4500) {
  const safeEndpoint = await assertSafeServerAutomationWebSocketUrl(getTitsEndpoint(endpoint, 'data'));
  return new Promise((resolve, reject) => {
    const message = makeTitsMessage(messageType, data);
    const ws = new WebSocket(safeEndpoint);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { }
      reject(new Error('T.I.T.S. response timeout'));
    }, timeoutMs);

    ws.once('open', () => {
      ws.send(JSON.stringify(message));
    });
    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(String(raw));
        if (parsed?.requestID && parsed.requestID !== message.requestID) return;
        clearTimeout(timer);
        try { ws.close(); } catch { }
        resolve(parsed);
      } catch (error) {
        clearTimeout(timer);
        try { ws.close(); } catch { }
        reject(error);
      }
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function normalizeTitsItems(response) {
  const items = response?.data?.items;
  return Array.isArray(items)
    ? items.map((item) => ({
      id: String(item.ID || item.id || ''),
      name: String(item.name || item.ID || ''),
      encodedImage: item.encodedImage || null
    })).filter((item) => item.id)
    : [];
}

function normalizeTitsTriggers(response) {
  const triggers = response?.data?.triggers;
  return Array.isArray(triggers)
    ? triggers.map((trigger) => ({
      id: String(trigger.ID || trigger.id || ''),
      name: String(trigger.name || trigger.ID || '')
    })).filter((trigger) => trigger.id || trigger.name)
    : [];
}

function getVtubeEndpoint(endpoint) {
  return String(endpoint || '').trim() || 'ws://localhost:8001';
}

function makeVtubeMessage(messageType, data = {}) {
  return {
    apiName: 'VTubeStudioPublicAPI',
    apiVersion: '1.0',
    requestID: `arubot_vts_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    messageType,
    data: data && typeof data === 'object' ? data : {}
  };
}

async function sendVtubeRequest(endpoint, messageType, data = {}, timeoutMs = 7000) {
  const safeEndpoint = await assertSafeServerAutomationWebSocketUrl(endpoint);
  return new Promise((resolve, reject) => {
    const message = makeVtubeMessage(messageType, data);
    const ws = new WebSocket(safeEndpoint);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { }
      reject(new Error('VTube Studio response timeout'));
    }, Math.max(1500, Math.min(30000, Number(timeoutMs || 7000))));

    ws.once('open', () => ws.send(JSON.stringify(message)));
    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(String(raw));
        if (parsed?.requestID && parsed.requestID !== message.requestID) return;
        clearTimeout(timer);
        try { ws.close(); } catch { }
        if (parsed?.messageType === 'APIError') {
          reject(new Error(parsed?.data?.message || 'VTube Studio API error'));
          return;
        }
        resolve(parsed);
      } catch (error) {
        clearTimeout(timer);
        try { ws.close(); } catch { }
        reject(error);
      }
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function normalizeVtubeDiscovery(responses = {}, endpoint = 'ws://localhost:8001') {
  const current = responses.current?.data || {};
  const models = Array.isArray(responses.models?.data?.availableModels)
    ? responses.models.data.availableModels.map((model) => ({
      id: String(model.modelID || ''),
      name: String(model.modelName || model.vtsModelName || model.modelID || ''),
      loaded: model.modelLoaded === true,
      fileName: String(model.vtsModelName || ''),
      iconName: String(model.vtsModelIconName || '')
    })).filter((model) => model.id)
    : [];
  const hotkeys = Array.isArray(responses.hotkeys?.data?.availableHotkeys)
    ? responses.hotkeys.data.availableHotkeys.map((hotkey) => ({
      id: String(hotkey.hotkeyID || ''),
      name: String(hotkey.name || hotkey.hotkeyID || ''),
      type: String(hotkey.type || ''),
      description: String(hotkey.description || ''),
      file: String(hotkey.file || '')
    })).filter((hotkey) => hotkey.id || hotkey.name)
    : [];
  const expressions = Array.isArray(responses.expressions?.data?.expressions)
    ? responses.expressions.data.expressions.map((expression) => ({
      name: String(expression.name || expression.file || ''),
      file: String(expression.file || ''),
      active: expression.active === true
    })).filter((expression) => expression.file || expression.name)
    : [];
  const parameterData = responses.parameters?.data || {};
  const parameters = [
    ...(Array.isArray(parameterData.defaultParameters) ? parameterData.defaultParameters : []),
    ...(Array.isArray(parameterData.customParameters) ? parameterData.customParameters : [])
  ].map((parameter) => ({
    id: String(parameter.id || parameter.name || parameter.parameterID || ''),
    name: String(parameter.name || parameter.id || parameter.parameterID || ''),
    min: Number.isFinite(Number(parameter.min)) ? Number(parameter.min) : null,
    max: Number.isFinite(Number(parameter.max)) ? Number(parameter.max) : null,
    defaultValue: Number.isFinite(Number(parameter.defaultValue)) ? Number(parameter.defaultValue) : null
  })).filter((parameter) => parameter.id || parameter.name);
  const itemData = responses.items?.data || {};
  const items = [
    ...(Array.isArray(itemData.itemsInScene) ? itemData.itemsInScene : []),
    ...(Array.isArray(itemData.availableItems) ? itemData.availableItems : [])
  ].map((item) => ({
    id: String(item.itemInstanceID || item.fileName || item.itemFileName || item.name || ''),
    name: String(item.name || item.fileName || item.itemFileName || item.itemInstanceID || ''),
    fileName: String(item.fileName || item.itemFileName || ''),
    instanceId: String(item.itemInstanceID || ''),
    loaded: !!item.itemInstanceID
  })).filter((item) => item.id || item.fileName);
  return {
    source: 'vtube_studio',
    endpoint: getVtubeEndpoint(endpoint),
    currentModel: {
      loaded: current.modelLoaded === true,
      id: String(current.modelID || ''),
      name: String(current.modelName || '')
    },
    models,
    hotkeys,
    expressions,
    parameters,
    items,
    fetchedAt: new Date().toISOString()
  };
}

async function discoverVtubeStudio(endpoint) {
  const target = getVtubeEndpoint(endpoint);
  const [current, models, hotkeys, expressions, parameters, items] = await Promise.all([
    sendVtubeRequest(target, 'CurrentModelRequest'),
    sendVtubeRequest(target, 'AvailableModelsRequest'),
    sendVtubeRequest(target, 'HotkeysInCurrentModelRequest'),
    sendVtubeRequest(target, 'ExpressionStateRequest', { details: false }),
    sendVtubeRequest(target, 'InputParameterListRequest').catch(() => null),
    sendVtubeRequest(target, 'ItemListRequest', {
      includeAvailableSpots: false,
      includeItemInstancesInScene: true,
      includeAvailableItemFiles: true
    }).catch(() => null)
  ]);
  return normalizeVtubeDiscovery({ current, models, hotkeys, expressions, parameters, items }, target);
}

function ownerFromControlToken(token) {
  const parts = String(token || '').split('_');
  if (parts.length < 3 || parts[0] !== 'ctl') return null;
  try {
    return Buffer.from(parts[1], 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function hashControlToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function getBearerToken(req) {
  const auth = String(req.get('authorization') || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(req.get('x-local-agent-token') || '').trim();
}

async function requireAutomationLocalAgent(req, res, next) {
  try {
    const token = getBearerToken(req);
    const agent = await authenticateAutomationLocalAgent(token);
    if (!agent) return res.status(401).json({ error: 'Invalid local program token' });
    req.automationLocalAgent = agent;
    return next();
  } catch (error) {
    console.error('[Automations] local agent auth error', error?.message || error);
    return res.status(401).json({ error: 'Invalid local program token' });
  }
}

const automationLocalAgentSocketsByOwner = new Map();

function getAutomationCapabilitiesFromMessage(message = {}) {
  const capabilities = message && typeof message.capabilities === 'object' ? message.capabilities : {};
  return {
    ...capabilities,
    transport: 'websocket',
    lastHeartbeatTransport: 'websocket'
  };
}

function registerAutomationLocalAgentSocket(agent, ws) {
  const owner = agent?.ownerUserId;
  if (!owner) return () => {};
  let sockets = automationLocalAgentSocketsByOwner.get(owner);
  if (!sockets) {
    sockets = new Set();
    automationLocalAgentSocketsByOwner.set(owner, sockets);
  }
  sockets.add(ws);
  return () => {
    const current = automationLocalAgentSocketsByOwner.get(owner);
    if (!current) return;
    current.delete(ws);
    if (current.size === 0) automationLocalAgentSocketsByOwner.delete(owner);
  };
}

function notifyAutomationLocalAgents(ownerUserId, reason = 'job_queued') {
  const owner = String(ownerUserId || '').trim();
  const sockets = automationLocalAgentSocketsByOwner.get(owner);
  if (!sockets?.size) return 0;
  const payload = JSON.stringify({ type: 'jobs.available', reason, at: new Date().toISOString() });
  let sent = 0;
  for (const ws of Array.from(sockets)) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        sent += 1;
      }
    } catch {}
  }
  return sent;
}

async function queueAutomationJob(ownerUserId, job) {
  const queued = await enqueueAutomationJob(ownerUserId, job);
  if (queued) {
    notifyAutomationLocalAgents(ownerUserId, 'job_queued');
    if (queued.owner_user_id && queued.owner_user_id !== ownerUserId) {
      notifyAutomationLocalAgents(queued.owner_user_id, 'job_queued');
    }
  }
  return queued;
}

function makeArubotViewerUuid(value) {
  return `aru_${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24)}`;
}

function collectPlatformPointIdentityKeys(account) {
  const keys = new Set();
  const provider = String(account?.provider || '').trim().toLowerCase();
  const add = (value, provider = '') => {
    const text = String(value || '').trim();
    if (!text) return;
    keys.add(text);
    if (text.startsWith('user:')) keys.add(text.slice(5));
    if (text.startsWith('cime:')) keys.add(text.slice(5));
    if (text.startsWith('chzzk:')) keys.add(text.slice(6));
    const normalizedProvider = String(provider || '').toLowerCase();
    if (normalizedProvider && !text.startsWith(`${normalizedProvider}:`)) {
      keys.add(`${normalizedProvider}:${text}`);
    }
  };

  add(account?.platform_user_id || account?.platformUserId, provider);
  add(account?.channel_id || account?.channelId, provider);
  add(account?.channel_handle || account?.handle, provider);
  const metadata = account?.metadata || {};
  const raw = metadata.raw || {};
  add(raw.userId, provider);
  add(raw.channelId, provider);
  add(raw.id, provider);
  add(raw.channel?.channelId, provider);
  add(raw.channel?.id, provider);
  add(raw.profile?.userId, provider);
  add(raw.profile?.channelId, provider);
  const publicProfile = metadata.publicProfile || {};
  add(publicProfile.userId, provider);
  add(publicProfile.channelId, provider);

  return Array.from(keys);
}

function collectViewerPointIdentityKeys(ownerUserId, platforms = []) {
  const keys = new Set();
  const add = (value) => {
    const text = String(value || '').trim();
    if (text) keys.add(text);
  };
  const accounts = Array.isArray(platforms) ? platforms : [];

  add(ownerUserId);
  add(makeArubotViewerUuid(ownerUserId));
  for (const account of accounts) {
    for (const key of collectPlatformPointIdentityKeys(account)) add(key);
  }
  return Array.from(keys);
}

async function getValidCimeAccessToken(ownerUserId) {
  let tokens = await getPlatformTokens('cime', ownerUserId);
  if (!tokens) throw new Error('No CIME tokens stored');
  const now = new Date();
  const expiresAt = new Date(tokens.expiresAt);
  if (isNaN(expiresAt.getTime()) || expiresAt <= now) {
    if (!tokens.refreshToken) throw new Error('No CIME refresh token stored');
    const platformUserId = tokens.platformUserId;
    const body = {
      grantType: 'refresh_token',
      clientId: CIME_CLIENT_ID,
      clientSecret: CIME_CLIENT_SECRET,
      refreshToken: tokens.refreshToken
    };
    const r = await axios.post(`${CIME_OPENAPI_BASE}/auth/v1/token`, body, {
      headers: { 'Content-Type': 'application/json' }
    });
    const payload = unwrapOpenApiContent(r);
    tokens = {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken || tokens.refreshToken,
      tokenType: payload.tokenType || 'Bearer',
      expiresAt: computeExpiresAt(payload.expiresIn || 86400),
      scope: payload.scope || tokens.scope
    };
    await upsertPlatformTokens('cime', ownerUserId, platformUserId, tokens);
  }
  return tokens.accessToken;
}

async function exchangeYoutubeToken(params) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null && value !== '') body.set(key, String(value));
  }
  const response = await axios.post(YOUTUBE_TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: DEFAULT_TIMEOUT
  });
  return response?.data || {};
}

async function getValidYoutubeAccessToken(ownerUserId) {
  let tokens = await getPlatformTokens('youtube', ownerUserId);
  if (!tokens) throw new Error('No YouTube tokens stored');
  const expiresAt = new Date(tokens.expiresAt);
  if (isNaN(expiresAt.getTime()) || expiresAt <= new Date(Date.now() + 60 * 1000)) {
    if (!tokens.refreshToken) {
      const error = new Error('No YouTube refresh token stored');
      error.provider = 'youtube';
      error.reauthRequired = true;
      error.status = 401;
      throw error;
    }
    const platformUserId = tokens.platformUserId;
    let payload;
    try {
      payload = await exchangeYoutubeToken({
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token'
      });
    } catch (e) {
      const message = e?.response?.data?.error_description || e?.response?.data?.error || e?.message || 'youtube_token_refresh_failed';
      const error = new Error(String(message));
      error.provider = 'youtube';
      error.reauthRequired = true;
      error.status = e?.response?.status || 401;
      throw error;
    }
    tokens = normalizeGoogleTokenPayload(payload, tokens);
    await upsertPlatformTokens('youtube', ownerUserId, platformUserId, tokens);
  }
  return tokens.accessToken;
}

async function getValidYoutubeBotProfile() {
  let profile = await getYoutubeBotProfile(YOUTUBE_BOT_PROFILE_ID);
  if (!profile?.accessToken) {
    const error = new Error('YouTube central bot is not configured');
    error.code = 'youtube_bot_not_configured';
    error.status = 409;
    throw error;
  }
  const expiresAt = new Date(profile.expiresAt);
  if (isNaN(expiresAt.getTime()) || expiresAt <= new Date(Date.now() + 60 * 1000)) {
    if (!profile.refreshToken) {
      await markYoutubeBotProfileStatus(profile.id, { status: 'reauth_required', lastError: 'No YouTube bot refresh token stored' }).catch(() => null);
      const error = new Error('No YouTube bot refresh token stored');
      error.code = 'youtube_bot_reauth_required';
      error.status = 401;
      throw error;
    }
    let payload;
    try {
      payload = await exchangeYoutubeToken({
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        refresh_token: profile.refreshToken,
        grant_type: 'refresh_token'
      });
    } catch (e) {
      const message = e?.response?.data?.error_description || e?.response?.data?.error || e?.message || 'youtube_bot_token_refresh_failed';
      await markYoutubeBotProfileStatus(profile.id, { status: 'reauth_required', lastError: message }).catch(() => null);
      const error = new Error(String(message));
      error.code = 'youtube_bot_reauth_required';
      error.status = e?.response?.status || 401;
      throw error;
    }
    const tokens = normalizeGoogleTokenPayload(payload, profile);
    profile = await updateYoutubeBotProfileTokens(profile.id, tokens);
  }
  return profile;
}

async function getValidYoutubeBotAccessToken() {
  const profile = await getValidYoutubeBotProfile();
  return profile.accessToken;
}

async function youtubeApiGetWithAccessToken(pathname, accessToken, params = {}, options = {}) {
  const relativePath = String(pathname || '').replace(/^\/+/, '');
  const url = new URL(relativePath, YOUTUBE_API_BASE.endsWith('/') ? YOUTUBE_API_BASE : `${YOUTUBE_API_BASE}/`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await axios.get(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    timeout: options.timeout || DEFAULT_TIMEOUT,
    responseType: options.responseType || 'json',
    signal: options.signal
  });
  return response;
}

async function youtubeApiGetPublic(pathname, params = {}, options = {}) {
  const relativePath = String(pathname || '').replace(/^\/+/, '');
  const url = new URL(relativePath, YOUTUBE_API_BASE.endsWith('/') ? YOUTUBE_API_BASE : `${YOUTUBE_API_BASE}/`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  if (YT_API_KEY) url.searchParams.set('key', YT_API_KEY);
  const headers = { Accept: 'application/json' };
  if (!YT_API_KEY) {
    const token = await getValidYoutubeBotAccessToken();
    headers.Authorization = `Bearer ${token}`;
  }
  return axios.get(url.toString(), {
    headers,
    timeout: options.timeout || DEFAULT_TIMEOUT,
    responseType: options.responseType || 'json',
    signal: options.signal
  });
}

async function youtubeApiGet(pathname, ownerUserId, params = {}, options = {}) {
  const accessToken = await getValidYoutubeAccessToken(ownerUserId);
  return youtubeApiGetWithAccessToken(pathname, accessToken, params, options);
}

async function youtubeApiPost(pathname, ownerUserId, params = {}, body = {}, options = {}) {
  const accessToken = await getValidYoutubeAccessToken(ownerUserId);
  const relativePath = String(pathname || '').replace(/^\/+/, '');
  const url = new URL(relativePath, YOUTUBE_API_BASE.endsWith('/') ? YOUTUBE_API_BASE : `${YOUTUBE_API_BASE}/`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await axios.post(url.toString(), body, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: options.timeout || DEFAULT_TIMEOUT
  });
  return response;
}

async function youtubeBotApiPost(pathname, params = {}, body = {}, options = {}) {
  const accessToken = await getValidYoutubeBotAccessToken();
  const relativePath = String(pathname || '').replace(/^\/+/, '');
  const url = new URL(relativePath, YOUTUBE_API_BASE.endsWith('/') ? YOUTUBE_API_BASE : `${YOUTUBE_API_BASE}/`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await axios.post(url.toString(), body, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: options.timeout || DEFAULT_TIMEOUT
  });
  return response;
}

async function fetchYoutubeMyChannelWithAccessToken(accessToken) {
  const url = new URL('channels', YOUTUBE_API_BASE.endsWith('/') ? YOUTUBE_API_BASE : `${YOUTUBE_API_BASE}/`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('mine', 'true');
  const response = await axios.get(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    timeout: DEFAULT_TIMEOUT
  });
  const item = Array.isArray(response?.data?.items) ? response.data.items[0] : null;
  return normalizeYoutubeProfile(item);
}

async function fetchYoutubeMyChannelsWithAccessToken(accessToken) {
  const url = new URL('channels', YOUTUBE_API_BASE.endsWith('/') ? YOUTUBE_API_BASE : `${YOUTUBE_API_BASE}/`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('mine', 'true');
  url.searchParams.set('maxResults', '50');
  const response = await axios.get(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    timeout: DEFAULT_TIMEOUT
  });
  return (Array.isArray(response?.data?.items) ? response.data.items : [])
    .map(normalizeYoutubeProfile)
    .filter((profile) => profile.channelId);
}

async function fetchYoutubeMyChannel(ownerUserId) {
  const response = await youtubeApiGet('channels', ownerUserId, { part: 'snippet', mine: 'true' });
  const item = Array.isArray(response?.data?.items) ? response.data.items[0] : null;
  return normalizeYoutubeProfile(item);
}

function publicYoutubeBotProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    selectedChannelId: profile.selectedChannelId,
    selectedChannelTitle: profile.selectedChannelTitle,
    selectedChannelHandle: profile.selectedChannelHandle,
    selectedChannelThumbnailUrl: profile.selectedChannelThumbnailUrl,
    status: profile.status,
    lastVerifiedAt: profile.lastVerifiedAt,
    lastError: profile.lastError,
    configuredBy: profile.configuredBy,
    updatedAt: profile.updatedAt,
    reauthRequired: isYoutubeReauthRequired({ lastError: profile.lastError, status: profile.status === 'reauth_required' ? 401 : 0 })
  };
}

function cleanupYoutubeBotPendingStore() {
  const now = Date.now();
  for (const [key, pending] of youtubeBotOAuthPendingStore.entries()) {
    if (!pending || now - Number(pending.createdAt || 0) > 10 * 60 * 1000) youtubeBotOAuthPendingStore.delete(key);
  }
}

function normalizeYoutubeChannelInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return { inputValue: '', channelId: '', handle: '' };
  let text = raw;
  if (!/^https?:\/\//i.test(text) && /^(www\.)?youtube\.com\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    const parts = url.pathname.split('/').map((part) => decodeURIComponent(part)).filter(Boolean);
    const channelIndex = parts.findIndex((part) => part.toLowerCase() === 'channel');
    if (channelIndex >= 0 && parts[channelIndex + 1]) {
      return { inputValue: raw, channelId: parts[channelIndex + 1], handle: '' };
    }
    const handlePart = parts.find((part) => part.startsWith('@'));
    if (handlePart) return { inputValue: raw, channelId: '', handle: handlePart.replace(/^@/, '') };
    if (url.hostname.toLowerCase().includes('youtube.com') && parts.length === 1 && parts[0].startsWith('@')) {
      return { inputValue: raw, channelId: '', handle: parts[0].replace(/^@/, '') };
    }
  } catch { }
  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(raw)) return { inputValue: raw, channelId: raw, handle: '' };
  const handle = raw.replace(/^@/, '').replace(/^https?:\/\/(www\.)?youtube\.com\/@/i, '').trim();
  return { inputValue: raw, channelId: '', handle };
}

async function resolveYoutubeChannelFromInput(input) {
  const parsed = normalizeYoutubeChannelInput(input);
  if (!parsed.inputValue) throw new Error('YouTube channel URL or handle is required');
  if (parsed.channelId) {
    try {
      const response = await youtubeApiGetPublic('channels', { part: 'snippet', id: parsed.channelId }, { timeout: 5000 });
      const item = Array.isArray(response?.data?.items) ? response.data.items[0] : null;
      const profile = normalizeYoutubeProfile(item);
      return {
        youtubeChannelId: parsed.channelId,
        youtubeHandle: profile.channelHandle || null,
        title: profile.channelName || null,
        thumbnailUrl: profile.channelImageUrl || null,
        inputValue: parsed.inputValue,
        resolved: !!profile.channelId,
        metadata: { parsed, raw: item || null }
      };
    } catch {
      return {
        youtubeChannelId: parsed.channelId,
        youtubeHandle: null,
        title: null,
        thumbnailUrl: null,
        inputValue: parsed.inputValue,
        resolved: true,
        metadata: { parsed }
      };
    }
  }
  if (!parsed.handle) throw new Error('YouTube channel URL or handle is required');
  const handle = parsed.handle.startsWith('@') ? parsed.handle : `@${parsed.handle}`;
  let response = await youtubeApiGetPublic('channels', { part: 'snippet', forHandle: handle }, { timeout: 5000 }).catch(() => null);
  let item = Array.isArray(response?.data?.items) ? response.data.items[0] : null;
  if (!item) {
    response = await youtubeApiGetPublic('search', { part: 'snippet', type: 'channel', q: handle, maxResults: 1 }, { timeout: 5000 }).catch(() => null);
    const found = Array.isArray(response?.data?.items) ? response.data.items[0] : null;
    const foundId = found?.snippet?.channelId || found?.id?.channelId || null;
    if (foundId) {
      const detail = await youtubeApiGetPublic('channels', { part: 'snippet', id: foundId }, { timeout: 5000 }).catch(() => null);
      item = Array.isArray(detail?.data?.items) ? detail.data.items[0] : null;
    }
  }
  const profile = normalizeYoutubeProfile(item);
  if (!profile.channelId) {
    return {
      youtubeChannelId: null,
      youtubeHandle: parsed.handle,
      title: null,
      thumbnailUrl: null,
      inputValue: parsed.inputValue,
      resolved: false,
      metadata: { parsed, resolutionError: 'channel_not_found' }
    };
  }
  return {
    youtubeChannelId: profile.channelId,
    youtubeHandle: profile.channelHandle || parsed.handle,
    title: profile.channelName,
    thumbnailUrl: profile.channelImageUrl,
    inputValue: parsed.inputValue,
    resolved: true,
    metadata: { parsed, raw: profile.metadata?.raw || null }
  };
}

function getYoutubeWebsubCallbackUrl(req) {
  const origin = BACKEND_ORIGIN || `${req.protocol}://${req.get('host')}`;
  return `${String(origin).replace(/\/$/, '')}${YOUTUBE_WEBSUB_CALLBACK_PATH}`;
}

function getYoutubeStudioModeratorUrl(channelId) {
  const id = String(channelId || '').trim();
  return id ? `https://studio.youtube.com/channel/${encodeURIComponent(id)}` : 'https://studio.youtube.com/';
}

function getYoutubeChannelUrl(channelId) {
  return channelId ? `https://www.youtube.com/channel/${encodeURIComponent(channelId)}` : null;
}

function getYoutubeWatchUrl(videoId) {
  return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : null;
}

async function subscribeYoutubeChannelWebsub(req, streamerChannel) {
  if (!streamerChannel?.youtubeChannelId) return { ok: false, status: 'unresolved_channel' };
  const callback = getYoutubeWebsubCallbackUrl(req);
  const topic = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(streamerChannel.youtubeChannelId)}`;
  const leaseSeconds = 864000;
  const body = new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.topic': topic,
    'hub.callback': callback,
    'hub.verify': 'async',
    'hub.lease_seconds': String(leaseSeconds)
  });
  if (YOUTUBE_WEBSUB_VERIFY_TOKEN) body.set('hub.verify_token', YOUTUBE_WEBSUB_VERIFY_TOKEN);
  await axios.post(YOUTUBE_WEBSUB_HUB_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: DEFAULT_TIMEOUT
  });
  const expiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  await updateYoutubeStreamerChannelWebsub(streamerChannel.ownerUserId, {
    websubStatus: 'subscribe_requested',
    websubLeaseExpiresAt: expiresAt,
    lastError: null
  }).catch(() => null);
  return { ok: true, status: 'subscribe_requested', callback, topic, expiresAt };
}

function buildYoutubeStreamerChannelFromProfile(profile, botProfile = null) {
  const youtubeChannelId = String(profile?.channelId || profile?.platformUserId || '').trim();
  if (!youtubeChannelId) return null;
  const rawHandle = String(profile?.channelHandle || '').trim();
  const youtubeHandle = rawHandle ? rawHandle.replace(/^@/, '') : null;
  const inputValue = youtubeHandle
    ? `https://www.youtube.com/@${youtubeHandle}`
    : `https://www.youtube.com/channel/${youtubeChannelId}`;
  return {
    youtubeChannelId,
    youtubeHandle,
    title: profile?.channelName || profile?.displayName || null,
    thumbnailUrl: profile?.channelImageUrl || profile?.avatarUrl || null,
    inputValue,
    botProfileId: botProfile?.id || null,
    resetModeratorRegistered: false,
    websubSecret: `ytws_${crypto.randomBytes(24).toString('base64url')}`,
    websubStatus: 'pending',
    lastError: null,
    metadata: {
      source: 'youtube_oauth',
      raw: profile?.metadata?.raw || null
    }
  };
}

async function upsertYoutubeStreamerChannelFromOAuthProfile(req, ownerUserId, profile) {
  const channel = buildYoutubeStreamerChannelFromProfile(
    profile,
    await getYoutubeBotProfile(YOUTUBE_BOT_PROFILE_ID).catch(() => null)
  );
  if (!channel) return { channel: null, websub: { ok: false, status: 'missing_channel_id' } };
  const streamerChannel = await upsertYoutubeStreamerChannel(ownerUserId, channel);
  let websub = { ok: false, status: streamerChannel.youtubeChannelId ? 'pending' : 'unresolved_channel' };
  if (streamerChannel.youtubeChannelId) {
    try {
      websub = await subscribeYoutubeChannelWebsub(req, streamerChannel);
    } catch (e) {
      await updateYoutubeStreamerChannelWebsub(ownerUserId, {
        websubStatus: 'subscribe_failed',
        websubLeaseExpiresAt: null,
        lastError: e?.response?.data || e?.message || 'websub_subscribe_failed'
      }).catch(() => null);
      websub = { ok: false, status: 'subscribe_failed', error: e?.message || 'websub_subscribe_failed' };
    }
  }
  return { channel: streamerChannel, websub };
}

async function fetchYoutubeVideoLiveDetails(videoId) {
  const id = String(videoId || '').trim();
  if (!id) return null;
  const response = await youtubeApiGetPublic('videos', {
    part: 'snippet,liveStreamingDetails',
    id
  }, { timeout: 7000 });
  const item = Array.isArray(response?.data?.items) ? response.data.items[0] : null;
  if (!item) return null;
  const details = item.liveStreamingDetails || {};
  const snippet = item.snippet || {};
  const startedAt = details.actualStartTime || details.scheduledStartTime || null;
  return {
    provider: 'youtube',
    broadcastId: id,
    videoId: id,
    videoUrl: getYoutubeWatchUrl(id),
    liveChatId: details.activeLiveChatId || null,
    title: snippet.title || '',
    channel: snippet.channelTitle || '',
    channelId: snippet.channelId || null,
    startedAt,
    startedAtTs: startedAt ? Date.parse(startedAt) : null,
    live: !!details.activeLiveChatId,
    raw: item
  };
}

async function fetchYoutubeActiveLiveForChannel(channelId) {
  const id = String(channelId || '').trim();
  if (!id) return null;
  const response = await youtubeApiGetPublic('search', {
    part: 'snippet',
    channelId: id,
    type: 'video',
    eventType: 'live',
    maxResults: 1,
    order: 'date'
  }, { timeout: 7000 });
  const item = Array.isArray(response?.data?.items) ? response.data.items[0] : null;
  const videoId = item?.id?.videoId || null;
  return videoId ? fetchYoutubeVideoLiveDetails(videoId) : null;
}

async function refreshYoutubeLiveFromRegisteredChannel(ownerUserId, options = {}) {
  const streamerChannel = await getYoutubeStreamerChannel(ownerUserId);
  if (!streamerChannel?.youtubeChannelId) return null;
  let liveInfo = null;
  if (streamerChannel.lastDetectedVideoId) {
    liveInfo = await fetchYoutubeVideoLiveDetails(streamerChannel.lastDetectedVideoId).catch(() => null);
  }
  if (!liveInfo?.live && options.allowSearch === true) {
    liveInfo = await fetchYoutubeActiveLiveForChannel(streamerChannel.youtubeChannelId).catch(() => null);
  }
  if (liveInfo?.liveChatId) {
    await updateYoutubeStreamerChannelLive(ownerUserId, {
      lastDetectedVideoId: liveInfo.videoId || liveInfo.broadcastId,
      lastLiveChatId: liveInfo.liveChatId,
      lastLiveTitle: liveInfo.title,
      lastLiveStartedAt: liveInfo.startedAt,
      lastError: null,
      metadata: { lastVideoUrl: liveInfo.videoUrl }
    }).catch(() => null);
    return liveInfo;
  }
  return liveInfo;
}

// GET /api/auth/chzzk/login -> redirect to CHZZK authorize page
app.get('/api/auth/chzzk/login', (req, res) => {
  try {
    if (!CHZZK_CLIENT_ID || !CHZZK_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Server not configured with CHZZK credentials' });
    }
    // Ensure per-user session id cookie exists
    // Do NOT create random sid pre-login; only set oauth_state here
    const state = createOAuthState('chzzk', req, { returnTo: getSafeFrontendReturnTo(req, req.query?.returnTo || req.query?.return_to) });
    setOAuthStateCookie(res, 'oauth_state', state);

    const authUrl = new URL('https://chzzk.naver.com/account-interlock');
    authUrl.searchParams.set('clientId', CHZZK_CLIENT_ID);
    authUrl.searchParams.set('redirectUri', CHZZK_REDIRECT_URI);
    authUrl.searchParams.set('state', state);

    return res.redirect(authUrl.toString());
  } catch (e) {
    console.error('Login redirect error', e);
    return res.status(500).json({ error: 'Login redirect failed' });
  }
});

app.get('/api/auth/youtube/login', (req, res) => {
  try {
    if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Server not configured with YouTube credentials' });
    }
    const requestedMode = String(req.query?.mode || '').trim();
    const mode = requestedMode === 'central_bot'
      ? 'central_bot'
      : requestedMode === 'viewer'
        ? 'viewer'
        : 'streamer_oauth';
    const scope = mode === 'central_bot'
      ? YOUTUBE_BOT_AUTH_SCOPE
      : mode === 'viewer'
        ? YOUTUBE_VIEWER_AUTH_SCOPE
        : YOUTUBE_STREAMER_AUTH_SCOPE;
    const start = async () => {
      if (mode === 'central_bot') {
        const admin = await requireCurrentAdminUser(req, res);
        if (!admin) return;
      }
      const state = createOAuthState('youtube', req, { mode, returnTo: getSafeFrontendReturnTo(req, req.query?.returnTo || req.query?.return_to) });
      setOAuthStateCookie(res, 'oauth_state_youtube', state);

      const authUrl = new URL(YOUTUBE_AUTH_URL);
      authUrl.searchParams.set('client_id', YOUTUBE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', YOUTUBE_REDIRECT_URI);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', scope);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('access_type', 'offline');
      if (mode === 'central_bot') authUrl.searchParams.set('include_granted_scopes', 'true');
      authUrl.searchParams.set('prompt', 'consent');
      return res.redirect(authUrl.toString());
    };
    return start().catch((e) => {
      console.error('[YouTube] Login redirect error', e?.message || e);
      return res.status(500).json({ error: 'YouTube login redirect failed' });
    });
  } catch (e) {
    console.error('[YouTube] Login redirect error', e?.message || e);
    return res.status(500).json({ error: 'YouTube login redirect failed' });
  }
});

app.get('/api/youtube/bot/login', (req, res) => {
  return res.redirect('/api/auth/youtube/login?mode=central_bot');
});

app.get('/api/auth/youtube/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    const savedState = req.cookies.oauth_state_youtube;
    const stateValidation = consumeOAuthState('youtube', state, savedState);

    if (error) {
      if (stateValidation.ok || savedState) clearManagedCookie(res, 'oauth_state_youtube');
      const errorCode = String(error || '');
      return res.redirect(getAuthRedirectUrlWithState(req, stateValidation, {
        auth: errorCode === 'access_denied' ? 'cancelled' : 'error',
        platform: 'youtube',
        reason: errorCode
      }));
    }

    if (!code || !state || !stateValidation.ok) {
      if (savedState) clearManagedCookie(res, 'oauth_state_youtube');
      console.warn('[YouTube] Invalid OAuth callback state/code:', {
        code: code ? 'present' : 'missing',
        state: state ? 'present' : 'missing',
        savedState: savedState ? 'present' : 'missing',
        stateValidation,
        error_description: error_description ? String(error_description) : null
      });
      return res.redirect(getAuthRedirectUrlWithState(req, stateValidation, {
        auth: 'error',
        platform: 'youtube',
        reason: !code ? 'missing_code' : 'invalid_state'
      }));
    }
    clearManagedCookie(res, 'oauth_state_youtube');

    const tokenPayload = await exchangeYoutubeToken({
      client_id: YOUTUBE_CLIENT_ID,
      client_secret: YOUTUBE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: YOUTUBE_REDIRECT_URI
    });
    const oauthMode = String(stateValidation.extra?.mode || '').trim();
    const tokenFallbackScope = oauthMode === 'viewer'
      ? YOUTUBE_VIEWER_AUTH_SCOPE
      : oauthMode === 'streamer_oauth'
        ? YOUTUBE_STREAMER_AUTH_SCOPE
        : YOUTUBE_BOT_AUTH_SCOPE;
    const tokens = normalizeGoogleTokenPayload(tokenPayload, {}, tokenFallbackScope);
    if (!tokens.accessToken) throw new Error('YouTube token response did not include access_token');

    if (oauthMode === 'central_bot') {
      const admin = await getCurrentAdminUserForCallback(req);
      const ownerUserId = admin?.userId || null;
      if (!ownerUserId) {
        return res.redirect(getArubotAdminRedirectUrl(req, { auth: 'error', platform: 'youtube', reason: 'admin_required' }));
      }
      const channels = await fetchYoutubeMyChannelsWithAccessToken(tokens.accessToken);
      if (!channels.length) throw new Error('YouTube channel profile did not include channel id');
      youtubeBotOAuthPendingStore.set(String(ownerUserId), {
        tokens,
        channels,
        createdAt: Date.now()
      });
      if (channels.length === 1) {
        const channel = channels[0];
        await upsertYoutubeBotProfile({
          id: YOUTUBE_BOT_PROFILE_ID,
          selectedChannelId: channel.channelId,
          selectedChannelTitle: channel.channelName,
          selectedChannelHandle: channel.channelHandle,
          selectedChannelThumbnailUrl: channel.channelImageUrl,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenType: tokens.tokenType,
          expiresAt: tokens.expiresAt,
          scope: tokens.scope,
          configuredBy: ownerUserId,
          status: 'active'
        });
        youtubeBotOAuthPendingStore.delete(String(ownerUserId));
        return res.redirect(getArubotAdminRedirectUrl(req, { auth: 'success', platform: 'youtube', reason: 'central_bot_configured' }));
      }
      return res.redirect(getArubotAdminRedirectUrl(req, { auth: 'success', platform: 'youtube', reason: 'central_bot_select_channel' }));
    }

    const profile = await fetchYoutubeMyChannelWithAccessToken(tokens.accessToken);
    if (!profile.platformUserId) throw new Error('YouTube channel profile did not include channel id');

    const preferredUserId = await getCurrentSessionUserId(req);
    const { userId } = await upsertPlatformIdentity('youtube', profile, preferredUserId);
    await upsertPlatformTokens('youtube', userId, profile.platformUserId, tokens);

    const sidToken = getCookieSid(req) || ('rt_' + crypto.randomBytes(32).toString('hex'));
    await upsertSession(sidToken, userId, 30);
    if (!getCookieSid(req)) setCookieSid(res, sidToken);
    if (oauthMode !== 'viewer') {
      await upsertYoutubeStreamerChannelFromOAuthProfile(req, userId, profile);
      ensureYoutubeSession(userId).catch((err) => {
        console.warn('[YouTube] Failed to start live chat session after OAuth callback:', err?.response?.data || err?.message || err);
      });
    }

    return res.redirect(getAuthRedirectUrlWithState(req, stateValidation, {
      auth: 'success',
      platform: 'youtube',
      reason: oauthMode === 'viewer' ? null : 'youtube_streamer_registered'
    }));
  } catch (e) {
    console.error('[YouTube] Callback error', e?.response?.data || e?.message || e);
    return res.redirect(getAuthRedirectUrl(req, { auth: 'error', platform: 'youtube' }));
  }
});

app.get('/api/auth/youtube/token', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const accessToken = await getValidYoutubeAccessToken(ownerUserId);
    const tokens = await getPlatformTokens('youtube', ownerUserId);
    return res.json({ accessToken, tokenType: tokens?.tokenType || 'Bearer', expiresAt: tokens?.expiresAt || null, scope: tokens?.scope || null });
  } catch (e) {
    const msg = String(e?.message || e);
    const status = msg.includes('No YouTube tokens') ? 404 : 500;
    return res.status(status).json({ error: msg });
  }
});

app.post('/api/auth/youtube/revoke', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const requestedPlatformUserId = String(req.body?.platformUserId || req.body?.platform_user_id || '').trim();
    const tokens = await getPlatformTokens('youtube', ownerUserId);
    const platformUserId = requestedPlatformUserId || tokens?.platformUserId || null;
    if (tokens && (!requestedPlatformUserId || String(tokens.platformUserId || '') === requestedPlatformUserId)) {
      const token = tokens.refreshToken || tokens.accessToken;
      if (token) {
        try {
          await axios.post(YOUTUBE_REVOKE_URL, new URLSearchParams({ token }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: DEFAULT_TIMEOUT
          });
        } catch { }
      }
      if (!requestedPlatformUserId) await deletePlatformTokens('youtube', ownerUserId);
    }
    closeYoutubeSession(ownerUserId, 'revoked');
    try { await deletePlatformAccount('youtube', ownerUserId, platformUserId); } catch { }
    const platforms = await listPlatformAccounts(ownerUserId).catch(() => []);
    return res.json({ ok: true, platforms });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to revoke YouTube tokens' });
  }
});

app.get('/api/auth/cime/login', (req, res) => {
  try {
    if (!CIME_CLIENT_ID || !CIME_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Server not configured with CIME credentials' });
    }
    const state = createOAuthState('cime', req, { returnTo: getSafeFrontendReturnTo(req, req.query?.returnTo || req.query?.return_to) });
    setOAuthStateCookie(res, 'oauth_state_cime', state);

    const authUrl = new URL(CIME_AUTH_URL);
    authUrl.searchParams.set('clientId', CIME_CLIENT_ID);
    authUrl.searchParams.set('redirectUri', CIME_REDIRECT_URI);
    authUrl.searchParams.set('state', state);
    if (CIME_AUTH_SCOPE) authUrl.searchParams.set('scope', CIME_AUTH_SCOPE);
    return res.redirect(authUrl.toString());
  } catch (e) {
    console.error('[CIME] Login redirect error', e?.message || e);
    return res.status(500).json({ error: 'CIME login redirect failed' });
  }
});

app.get('/api/auth/cime/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    const savedState = req.cookies.oauth_state_cime;
    const stateValidation = consumeOAuthState('cime', state, savedState);

    if (error) {
      if (stateValidation.ok || savedState) {
        clearManagedCookie(res, 'oauth_state_cime');
      }
      const errorCode = String(error || '');
      const authStatus = errorCode === 'access_denied' ? 'cancelled' : 'error';
      console.warn('[CIME] OAuth authorization did not complete:', {
        error: errorCode,
        description: error_description ? String(error_description) : null,
        state: state ? 'present' : 'missing',
        savedState: savedState ? 'present' : 'missing',
        stateValidation
      });
      return res.redirect(getAuthRedirectUrlWithState(req, stateValidation, {
        auth: authStatus,
        platform: 'cime',
        reason: errorCode
      }));
    }

    if (!code || !state || !stateValidation.ok) {
      console.warn('[CIME] Invalid OAuth callback state/code:', {
        code: code ? 'present' : 'missing',
        state: state ? 'present' : 'missing',
        savedState: savedState ? 'present' : 'missing',
        stateValidation
      });
      if (savedState) clearManagedCookie(res, 'oauth_state_cime');
      return res.redirect(getAuthRedirectUrlWithState(req, stateValidation, {
        auth: 'error',
        platform: 'cime',
        reason: !code ? 'missing_code' : 'invalid_state'
      }));
    }
    clearManagedCookie(res, 'oauth_state_cime');

    const tokenResp = await axios.post(`${CIME_OPENAPI_BASE}/auth/v1/token`, {
      grantType: 'authorization_code',
      clientId: CIME_CLIENT_ID,
      clientSecret: CIME_CLIENT_SECRET,
      code
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    const tokenPayload = unwrapOpenApiContent(tokenResp);
    const { accessToken, refreshToken, tokenType, expiresIn, scope } = tokenPayload;
    if (!accessToken || !refreshToken) {
      console.error('[CIME] Unexpected token response', tokenResp?.data);
      return res.status(500).send('Failed to obtain CIME tokens');
    }

    const me = await axios.get(`${CIME_OPENAPI_BASE}/open/v1/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const profile = await platformProfiles.enrichCimeProfile(normalizeCimeProfile(unwrapOpenApiContent(me)), accessToken);
    if (!profile.platformUserId) {
      return res.status(502).send('CIME user profile did not include channelId');
    }

    const preferredUserId = await getCurrentSessionUserId(req);
    const { userId } = await upsertPlatformIdentity('cime', profile, preferredUserId);
    await upsertPlatformTokens('cime', userId, profile.platformUserId, {
      accessToken,
      refreshToken,
      tokenType: tokenType || 'Bearer',
      expiresAt: computeExpiresAt(expiresIn || 86400),
      scope
    });

    const sidToken = getCookieSid(req) || ('rt_' + crypto.randomBytes(32).toString('hex'));
    await upsertSession(sidToken, userId, 30);
    if (!getCookieSid(req)) setCookieSid(res, sidToken);
    ensureCimeSession(userId).catch((err) => {
      console.warn('[CIME] Failed to start event session after OAuth callback:', err?.response?.data || err?.message || err);
    });

    return res.redirect(getAuthRedirectUrlWithState(req, stateValidation, { auth: 'success', platform: 'cime', reason: null }));
  } catch (e) {
    console.error('[CIME] Callback error', e?.response?.data || e.message);
    return res.redirect(getAuthRedirectUrl(req, { auth: 'error', platform: 'cime' }));
  }
});

app.get('/api/auth/cime/token', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const accessToken = await getValidCimeAccessToken(ownerUserId);
    const tokens = await getPlatformTokens('cime', ownerUserId);
    return res.json({ accessToken, tokenType: tokens?.tokenType || 'Bearer', expiresAt: tokens?.expiresAt || null, scope: tokens?.scope || null });
  } catch (e) {
    const msg = String(e?.message || e);
    const status = msg.includes('No CIME tokens') ? 404 : 500;
    return res.status(status).json({ error: msg });
  }
});

app.post('/api/auth/cime/revoke', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const requestedPlatformUserId = String(req.body?.platformUserId || req.body?.platform_user_id || '').trim();
    const tokens = await getPlatformTokens('cime', ownerUserId);
    const platformUserId = requestedPlatformUserId || tokens?.platformUserId || null;
    if (tokens && (!requestedPlatformUserId || String(tokens.platformUserId || '') === requestedPlatformUserId)) {
      for (const [token, tokenTypeHint] of [[tokens.accessToken, 'access_token'], [tokens.refreshToken, 'refresh_token']]) {
        if (!token) continue;
        try {
          await axios.post(`${CIME_OPENAPI_BASE}/auth/v1/token/revoke`, {
            clientId: CIME_CLIENT_ID,
            clientSecret: CIME_CLIENT_SECRET,
            token,
            tokenTypeHint
          }, { headers: { 'Content-Type': 'application/json' } });
        } catch { }
      }
      if (!requestedPlatformUserId) await deletePlatformTokens('cime', ownerUserId);
    }
    try { await deletePlatformAccount('cime', ownerUserId, platformUserId); } catch { }
    const platforms = await listPlatformAccounts(ownerUserId).catch(() => []);
    return res.json({ ok: true, platforms });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to revoke CIME tokens' });
  }
});

app.get('/api/cime/me', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const accessToken = await getValidCimeAccessToken(ownerUserId);
    const me = await axios.get(`${CIME_OPENAPI_BASE}/open/v1/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const content = unwrapOpenApiContent(me);
    return res.json({
      provider: 'cime',
      channelId: content.channelId,
      channelName: content.channelName,
      channelHandle: content.channelHandle,
      channelImageUrl: content.channelImageUrl
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to fetch CIME user info' });
  }
});

app.post('/api/cime/chat/send', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const { message, senderType = 'APP' } = req.body || {};
    const text = String(message || '').trim();
    if (!text) return res.status(400).json({ error: 'message is required' });
    if (text.length > 100) return res.status(400).json({ error: 'message must be <= 100 characters' });
    const accessToken = await getValidCimeAccessToken(ownerUserId);
    const r = await axios.post(`${CIME_OPENAPI_BASE}/open/v1/chats/send`, {
      message: text,
      senderType: String(senderType || 'APP').toUpperCase() === 'USER' ? 'USER' : 'APP'
    }, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });
    const content = unwrapOpenApiContent(r);
    return res.json({ messageId: content?.messageId || null });
  } catch (e) {
    console.error('[CIME] Chat send error', e?.response?.data || e.message);
    return res.status(500).json({ error: 'Failed to send CIME chat' });
  }
});

app.get('/api/cime/live/me', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const accessToken = await getValidCimeAccessToken(ownerUserId);
    const me = await axios.get(`${CIME_OPENAPI_BASE}/open/v1/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const profile = normalizeCimeProfile(unwrapOpenApiContent(me));
    if (!profile.channelId) return res.status(409).json({ error: 'No CIME channel linked' });
    const live = await axios.get(`${CIME_OPENAPI_BASE}/v1/${encodeURIComponent(profile.channelId)}/live-status`);
    return res.json(unwrapOpenApiContent(live));
  } catch (e) {
    return res.status(500).json({ error: 'Failed to fetch CIME live status' });
  }
});

app.get('/api/arubot-admin/me', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.json({ userId: null, isAdmin: false });
    const admin = await getAppUserAdminStatus(ownerUserId).catch(() => null);
    return res.json({
      userId: ownerUserId,
      isAdmin: admin?.isAdmin === true,
      displayName: admin?.displayName || null,
      avatarUrl: admin?.avatarUrl || null
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load AruBot admin status' });
  }
});

app.get('/api/youtube/bot/status', async (req, res) => {
  try {
    const admin = await requireCurrentAdminUser(req, res);
    if (!admin) return;
    const ownerUserId = admin.userId;
    cleanupYoutubeBotPendingStore();
    const profile = await getYoutubeBotProfile(YOUTUBE_BOT_PROFILE_ID);
    const pending = youtubeBotOAuthPendingStore.get(String(ownerUserId)) || null;
    return res.json({
      configured: !!profile?.selectedChannelId && profile.status !== 'deleted',
      profile: publicYoutubeBotProfile(profile),
      pending: pending ? {
        channels: (pending.channels || []).map((channel) => ({
          channelId: channel.channelId,
          channelName: channel.channelName,
          channelHandle: channel.channelHandle,
          channelImageUrl: channel.channelImageUrl
        })),
        expiresAt: new Date(Number(pending.createdAt || Date.now()) + 10 * 60 * 1000).toISOString()
      } : null
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load YouTube bot status' });
  }
});

app.post('/api/youtube/bot/select-channel', rateLimiters.userWrite, async (req, res) => {
  try {
    const admin = await requireCurrentAdminUser(req, res);
    if (!admin) return;
    const ownerUserId = admin.userId;
    cleanupYoutubeBotPendingStore();
    const pending = youtubeBotOAuthPendingStore.get(String(ownerUserId));
    if (!pending) return res.status(409).json({ error: 'No pending YouTube bot OAuth session' });
    const requestedChannelId = String(req.body?.channelId || '').trim();
    const channel = (pending.channels || []).find((item) => String(item.channelId || '') === requestedChannelId);
    if (!channel) return res.status(400).json({ error: 'Selected channel is not available in the pending OAuth session' });
    const profile = await upsertYoutubeBotProfile({
      id: YOUTUBE_BOT_PROFILE_ID,
      selectedChannelId: channel.channelId,
      selectedChannelTitle: channel.channelName,
      selectedChannelHandle: channel.channelHandle,
      selectedChannelThumbnailUrl: channel.channelImageUrl,
      accessToken: pending.tokens.accessToken,
      refreshToken: pending.tokens.refreshToken,
      tokenType: pending.tokens.tokenType,
      expiresAt: pending.tokens.expiresAt,
      scope: pending.tokens.scope,
      configuredBy: ownerUserId,
      status: 'active'
    });
    youtubeBotOAuthPendingStore.delete(String(ownerUserId));
    return res.json({ ok: true, profile: publicYoutubeBotProfile(profile) });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to select YouTube bot channel' });
  }
});

app.post('/api/youtube/bot/verify', rateLimiters.userWrite, async (req, res) => {
  try {
    const admin = await requireCurrentAdminUser(req, res);
    if (!admin) return;
    const ownerUserId = admin.userId;
    const profile = await getValidYoutubeBotProfile();
    const channels = await fetchYoutubeMyChannelsWithAccessToken(profile.accessToken);
    const matched = channels.find((channel) => String(channel.channelId || '') === String(profile.selectedChannelId || ''));
    if (!matched) {
      const updated = await markYoutubeBotProfileStatus(profile.id, { status: 'reauth_required', lastError: 'Selected bot channel is not available for this OAuth token' });
      return res.status(409).json({ ok: false, profile: publicYoutubeBotProfile(updated), error: 'Selected bot channel is not available for this OAuth token' });
    }
    const updated = await upsertYoutubeBotProfile({
      id: profile.id,
      selectedChannelId: matched.channelId,
      selectedChannelTitle: matched.channelName,
      selectedChannelHandle: matched.channelHandle,
      selectedChannelThumbnailUrl: matched.channelImageUrl,
      accessToken: profile.accessToken,
      refreshToken: profile.refreshToken,
      tokenType: profile.tokenType,
      expiresAt: profile.expiresAt,
      scope: profile.scope,
      configuredBy: ownerUserId,
      status: 'active'
    });
    return res.json({ ok: true, profile: publicYoutubeBotProfile(updated) });
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ error: e?.message || 'Failed to verify YouTube bot channel' });
  }
});

app.delete('/api/youtube/bot', rateLimiters.userWrite, async (req, res) => {
  try {
    const admin = await requireCurrentAdminUser(req, res);
    if (!admin) return;
    const profile = await getYoutubeBotProfile(YOUTUBE_BOT_PROFILE_ID);
    if (profile?.accessToken) {
      try {
        await axios.post(YOUTUBE_REVOKE_URL, new URLSearchParams({ token: profile.accessToken }).toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: DEFAULT_TIMEOUT
        });
      } catch { }
    }
    await deleteYoutubeBotProfile(YOUTUBE_BOT_PROFILE_ID);
    for (const key of Array.from(youtubeSessionStore.keys())) closeYoutubeSession(key, 'bot_profile_deleted');
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete YouTube bot profile' });
  }
});

app.get('/api/youtube/me', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const profile = await fetchYoutubeMyChannel(ownerUserId);
    return res.json({ channelId: profile.channelId, channelName: profile.channelName, channelHandle: profile.channelHandle, channelImageUrl: profile.channelImageUrl });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to fetch YouTube channel info' });
  }
});

app.get('/api/youtube/live/me', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const state = await refreshYoutubeLiveStatus(ownerUserId, `user:${ownerUserId}`, { force: true });
    return res.json(state);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to fetch YouTube live status' });
  }
});

app.get('/api/youtube/streamer-channel', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const botProfile = await getYoutubeBotProfile(YOUTUBE_BOT_PROFILE_ID);
    const streamerChannel = await getYoutubeStreamerChannel(ownerUserId);
    return res.json({
      configured: !!streamerChannel,
      botConfigured: !!botProfile?.selectedChannelId,
      botProfile: publicYoutubeBotProfile(botProfile),
      channel: streamerChannel ? {
        youtubeChannelId: streamerChannel.youtubeChannelId,
        youtubeHandle: streamerChannel.youtubeHandle,
        title: streamerChannel.title,
        thumbnailUrl: streamerChannel.thumbnailUrl,
        inputValue: streamerChannel.inputValue,
        moderatorRegistered: streamerChannel.moderatorRegistered,
        websubStatus: streamerChannel.websubStatus,
        lastDetectedVideoId: streamerChannel.lastDetectedVideoId,
        lastLiveChatId: streamerChannel.lastLiveChatId,
        lastLiveTitle: streamerChannel.lastLiveTitle,
        lastError: streamerChannel.lastError,
        moderatorUrl: getYoutubeStudioModeratorUrl(streamerChannel.youtubeChannelId),
        botChannelUrl: getYoutubeChannelUrl(botProfile?.selectedChannelId),
      } : null
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load YouTube streamer channel' });
  }
});

app.post('/api/youtube/streamer-channel', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const botProfile = await getYoutubeBotProfile(YOUTUBE_BOT_PROFILE_ID);
    if (!botProfile?.selectedChannelId || botProfile.status === 'reauth_required') {
      return res.status(409).json({ error: 'YouTube central bot is not configured', code: 'youtube_bot_not_configured' });
    }
    const input = String(req.body?.channel || req.body?.url || req.body?.handle || '').trim();
    const resolved = await resolveYoutubeChannelFromInput(input);
    const websubSecret = `ytws_${crypto.randomBytes(24).toString('base64url')}`;
    const streamerChannel = await upsertYoutubeStreamerChannel(ownerUserId, {
      ...resolved,
      botProfileId: botProfile.id,
      websubSecret,
      websubStatus: resolved.youtubeChannelId ? 'pending' : 'unresolved_channel',
      lastError: resolved.youtubeChannelId ? null : 'channel_id_required_for_websub'
    });
    let websub = { ok: false, status: 'unresolved_channel' };
    if (streamerChannel.youtubeChannelId) {
      try {
        websub = await subscribeYoutubeChannelWebsub(req, streamerChannel);
      } catch (e) {
        await updateYoutubeStreamerChannelWebsub(ownerUserId, {
          websubStatus: 'subscribe_failed',
          websubLeaseExpiresAt: null,
          lastError: e?.response?.data || e?.message || 'websub_subscribe_failed'
        }).catch(() => null);
        websub = { ok: false, status: 'subscribe_failed', error: e?.message || 'websub_subscribe_failed' };
      }
    }
    return res.json({
      ok: true,
      resolved: !!streamerChannel.youtubeChannelId,
      channel: {
        youtubeChannelId: streamerChannel.youtubeChannelId,
        youtubeHandle: streamerChannel.youtubeHandle,
        title: streamerChannel.title,
        thumbnailUrl: streamerChannel.thumbnailUrl,
        inputValue: streamerChannel.inputValue,
        moderatorRegistered: streamerChannel.moderatorRegistered,
        websubStatus: websub.status || streamerChannel.websubStatus,
        moderatorUrl: getYoutubeStudioModeratorUrl(streamerChannel.youtubeChannelId),
        botChannelUrl: getYoutubeChannelUrl(botProfile.selectedChannelId),
        botChannelTitle: botProfile.selectedChannelTitle || 'AruBot',
      },
      instructions: {
        botChannelUrl: getYoutubeChannelUrl(botProfile.selectedChannelId),
        botChannelTitle: botProfile.selectedChannelTitle || 'AruBot',
        moderatorUrl: getYoutubeStudioModeratorUrl(streamerChannel.youtubeChannelId),
        text: '등록한 채널의 YouTube Studio가 열리면 설정 > 커뮤니티 > 사용자 관리로 이동해 AruBot 채널 URL을 표준 운영자 또는 관리 운영자에 추가하고 저장하세요.'
      },
      websub
    });
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ error: e?.message || 'Failed to register YouTube streamer channel' });
  }
});

app.post('/api/youtube/streamer-channel/moderator-confirmed', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const verification = await verifyYoutubeBotModeratorRegistration(ownerUserId);
    if (!verification.verified) {
      await markYoutubeStreamerChannelModeratorRegistered(ownerUserId, false, verification.message || verification.reason).catch(() => null);
      return res.status(409).json({
        ok: false,
        moderatorRegistered: false,
        verification
      });
    }
    const streamerChannel = await markYoutubeStreamerChannelModeratorRegistered(ownerUserId, true);
    if (!streamerChannel) return res.status(404).json({ error: 'YouTube streamer channel is not registered' });
    closeYoutubeSession(ownerUserId, 'moderator_confirmed');
    ensureYoutubeSession(ownerUserId).catch((e) => {
      console.warn('[YouTube] Failed to start session after moderator confirmation:', e?.response?.data || e?.message || e);
    });
    return res.json({ ok: true, moderatorRegistered: true, verification });
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({
      error: e?.message || 'Failed to confirm YouTube moderator registration',
      code: e?.code || 'youtube_moderator_verification_failed'
    });
  }
});

app.delete('/api/youtube/streamer-channel', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    closeYoutubeSession(ownerUserId, 'streamer_channel_deleted');
    await deleteYoutubeStreamerChannel(ownerUserId);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete YouTube streamer channel' });
  }
});

app.get(YOUTUBE_WEBSUB_CALLBACK_PATH, async (req, res) => {
  const mode = String(req.query['hub.mode'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  const token = String(req.query['hub.verify_token'] || '');
  if (YOUTUBE_WEBSUB_VERIFY_TOKEN && token !== YOUTUBE_WEBSUB_VERIFY_TOKEN) {
    return res.status(403).send('invalid verify token');
  }
  if ((mode === 'subscribe' || mode === 'unsubscribe') && challenge) {
    return res.status(200).type('text/plain').send(challenge);
  }
  return res.status(400).send('invalid websub verification');
});

function extractYoutubeWebsubEntries(xml) {
  const text = String(xml || '');
  const entries = [];
  const entryMatches = text.match(/<entry[\s\S]*?<\/entry>/g) || [];
  for (const entry of entryMatches) {
    const videoId = (entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1] || '';
    const channelId = (entry.match(/<yt:channelId>([^<]+)<\/yt:channelId>/) || [])[1] || '';
    const title = (entry.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    if (videoId && channelId) entries.push({ videoId, channelId, title });
  }
  return entries;
}

function scheduleYoutubeWebsubLiveRetry(ownerUserId, videoId, attempt = 0) {
  const delay = YOUTUBE_WEBSUB_RETRY_DELAYS_MS[attempt];
  if (!Number.isFinite(delay)) return;
  setTimeout(() => {
    processYoutubeDetectedVideo(ownerUserId, videoId, attempt + 1).catch((e) => {
      console.warn('[YouTube WebSub] bounded retry failed:', e?.message || e);
    });
  }, delay);
}

async function processYoutubeDetectedVideo(ownerUserId, videoId, nextAttempt = 0) {
  const liveInfo = await fetchYoutubeVideoLiveDetails(videoId).catch(() => null);
  if (!liveInfo) {
    await updateYoutubeStreamerChannelLive(ownerUserId, {
      lastDetectedVideoId: videoId,
      lastLiveChatId: null,
      lastError: 'video_not_found'
    }).catch(() => null);
    return null;
  }
  if (liveInfo.liveChatId) {
    await updateYoutubeStreamerChannelLive(ownerUserId, {
      lastDetectedVideoId: videoId,
      lastLiveChatId: liveInfo.liveChatId,
      lastLiveTitle: liveInfo.title,
      lastLiveStartedAt: liveInfo.startedAt,
      lastError: null,
      metadata: { lastVideoUrl: liveInfo.videoUrl }
    }).catch(() => null);
    closeYoutubeSession(ownerUserId, 'websub_live_detected');
    ensureYoutubeSession(ownerUserId).catch((e) => {
      console.warn('[YouTube WebSub] session start failed:', e?.response?.data || e?.message || e);
    });
  } else {
    await updateYoutubeStreamerChannelLive(ownerUserId, {
      lastDetectedVideoId: videoId,
      lastLiveChatId: null,
      lastLiveTitle: liveInfo.title,
      lastLiveStartedAt: liveInfo.startedAt,
      lastError: 'live_chat_not_active_yet',
      metadata: { lastVideoUrl: liveInfo.videoUrl }
    }).catch(() => null);
    scheduleYoutubeWebsubLiveRetry(ownerUserId, videoId, nextAttempt);
  }
  return liveInfo;
}

app.post(YOUTUBE_WEBSUB_CALLBACK_PATH, async (req, res) => {
  try {
    const entries = extractYoutubeWebsubEntries(req.body);
    res.status(204).end();
    for (const entry of entries) {
      const streamerChannels = await listYoutubeStreamerChannelsByYoutubeChannelId(entry.channelId).catch(() => []);
      for (const streamerChannel of streamerChannels) {
        processYoutubeDetectedVideo(streamerChannel.ownerUserId, entry.videoId).catch((e) => {
          console.warn('[YouTube WebSub] detected video processing failed:', e?.message || e);
        });
      }
    }
  } catch (e) {
    if (!res.headersSent) return res.status(500).send('websub processing failed');
  }
});

app.get('/api/youtube/status', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const sid = `user:${ownerUserId}`;
    const botProfile = await getYoutubeBotProfile(YOUTUBE_BOT_PROFILE_ID);
    const streamerChannel = await getYoutubeStreamerChannel(ownerUserId);
    const entry = youtubeSessionStore.get(ownerUserId) || null;
    const shouldRefresh = String(req.query?.refresh || '').toLowerCase() === 'true';
    const liveState = shouldRefresh
      ? await refreshYoutubeLiveStatus(ownerUserId, sid, { force: true })
      : (liveStatusCache.get(sid) || null);
    return res.json({
      provider: 'youtube',
      connected: !!botProfile?.selectedChannelId && !!streamerChannel?.youtubeChannelId,
      botConfigured: !!botProfile?.selectedChannelId,
      botProfile: publicYoutubeBotProfile(botProfile),
      channelId: streamerChannel?.youtubeChannelId || null,
      channelName: streamerChannel?.title || streamerChannel?.youtubeHandle || null,
      channelHandle: streamerChannel?.youtubeHandle || null,
      live: !!liveState?.live,
      liveChatId: liveState?.liveChatId || entry?.liveChatId || null,
      broadcastId: liveState?.broadcastId || entry?.broadcastId || null,
      streamConnected: !!entry?.connected,
      hasStream: !!entry?.chatClient,
      queueSize: Array.isArray(entry?.queue) ? entry.queue.length : 0,
      lastMessageAt: entry?.lastMessageAt || null,
      lastError: entry?.lastError || null,
      lastStatus: entry?.lastStatus || null,
      reauthRequired: isYoutubeReauthRequired(entry),
      ignoredDonations: getYoutubeIgnoredDonationSummary(entry),
      reconnectAttempts: Number(entry?.reconnectAttempts || 0),
      mode: 'youtube-chat'
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load YouTube status' });
  }
});

app.post('/api/youtube/chat/send', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'message required' });
    const entry = await ensureYoutubeSession(ownerUserId);
    if (!entry.liveChatId) return res.status(409).json({ error: 'No active YouTube live chat' });
    const sent = await sendYoutubeChat(ownerUserId, entry.liveChatId, message);
    return res.json({ ok: true, sent });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to send YouTube chat' });
  }
});

app.get('/api/account/platforms', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.json({ userId: null, sid: null, platforms: [] });
    const platforms = await listPlatformAccounts(ownerUserId).catch(() => []);
    return res.json({ userId: ownerUserId, sid: `user:${ownerUserId}`, platforms });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load platform accounts' });
  }
});

function deleteRuntimeMapEntriesBySid(map, sid) {
  if (!map || !sid) return;
  for (const [key, value] of Array.from(map.entries())) {
    if (String(value || '') === sid) map.delete(key);
  }
}

function closeSocketSetForSid(map, sid, reason = 'account_deleted') {
  const sockets = map?.get?.(sid);
  if (sockets && typeof sockets[Symbol.iterator] === 'function') {
    for (const socket of sockets) {
      try { socket.close?.(1000, reason); } catch { }
      try { socket.terminate?.(); } catch { }
    }
  }
  try { map?.delete?.(sid); } catch { }
}

function closeCimeSession(ownerUserId, reason = 'account_deleted') {
  const entry = cimeSessionStore.get(ownerUserId);
  if (!entry) return false;
  if (entry.pingTimer) clearInterval(entry.pingTimer);
  if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
  entry.connected = false;
  entry.closeReason = reason;
  try { entry.ws?.close?.(1000, reason); } catch { }
  try { entry.ws?.terminate?.(); } catch { }
  cimeSessionStore.delete(ownerUserId);
  return true;
}

function deleteAutomationSoundDirectory(ownerUserId) {
  const target = path.resolve(automationSoundDir(ownerUserId));
  const root = path.resolve(AUTOMATION_USER_FILE_ROOT);
  const normalizedTarget = target.toLowerCase();
  const normalizedRoot = root.toLowerCase();
  if (!normalizedTarget.startsWith(`${normalizedRoot}${path.sep.toLowerCase()}`)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

function clearDeletedAccountRuntimeState(ownerUserId) {
  const owner = String(ownerUserId || '').replace(/^user:/, '').trim();
  if (!owner) return { sid: null, soundFilesDeleted: false };
  const sid = `user:${owner}`;
  try { closeYoutubeSession(owner, 'account_deleted'); } catch { }
  try { closeCimeSession(owner, 'account_deleted'); } catch { }
  const chzzkEntry = sessionStore.get(sid);
  try { chzzkEntry?.socket?.disconnect?.(); } catch { }
  try { chzzkEntry?.socket?.close?.(); } catch { }
  sessionStore.delete(sid);
  activeSids.delete(sid);
  liveSession.delete(sid);
  liveStatusCache.delete(sid);
  macroCache.delete(sid);
  macroLastSent.delete(sid);
  try { macroTimerManager.macroTimers.delete(sid); } catch { }
  try { macroTimerManager.failureCount.delete(sid); } catch { }
  try { macroTimerManager.lastFailureTime.delete(sid); } catch { }
  try { performanceMonitor.metrics.delete(sid); } catch { }
  videoDonationQueues.delete(sid);
  const videoTimer = videoDonationTimers.get(sid);
  if (videoTimer) clearTimeout(videoTimer);
  videoDonationTimers.delete(sid);
  pvdPlaybackState.delete(sid);
  rouletteQueues.delete(sid);
  rouletteProcessing.delete(sid);
  rouletteLastResultSent.delete(sid);
  rouletteLastEnqueue.delete(sid);
  drawingDonationQueues.delete(sid);
  closeSocketSetForSid(pvdSidSockets, sid);
  closeSocketSetForSid(pvdAdminSockets, sid);
  closeSocketSetForSid(drawingOverlaySockets, sid);
  closeSocketSetForSid(drawingAdminSockets, sid);
  try { closeSocketSetForSid(fxSidSockets, sid); } catch { }
  deleteRuntimeMapEntriesBySid(pvdTokenToSid, sid);
  deleteRuntimeMapEntriesBySid(rouletteTokenToSid, sid);
  deleteRuntimeMapEntriesBySid(drawingTokenToSid, sid);
  for (const key of Array.from(viewerPlatformLiveCache.keys())) {
    if (String(key).startsWith(`${owner}:`)) viewerPlatformLiveCache.delete(key);
  }
  let soundFilesDeleted = false;
  try { soundFilesDeleted = deleteAutomationSoundDirectory(owner); } catch (error) {
    console.warn('[Privacy] Automation sound directory cleanup failed:', error?.message || error);
  }
  return { sid, soundFilesDeleted };
}

app.delete('/api/account', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const confirmation = String(req.body?.confirm || req.query?.confirm || '').trim();
    if (confirmation !== 'delete-account') {
      return res.status(400).json({ error: 'Deletion confirmation required', requiredConfirm: 'delete-account' });
    }
    const result = await deleteAccountData(ownerUserId, { reason: 'self_service_delete' });
    const runtime = clearDeletedAccountRuntimeState(ownerUserId);
    clearManagedCookie(res, 'oauth_state');
    clearManagedCookie(res, 'oauth_state_cime');
    clearManagedCookie(res, 'oauth_state_youtube');
    clearManagedCookie(res, 'sid');
    return res.json({ ok: true, ...result, runtime });
  } catch (e) {
    console.error('[Privacy] Account delete failed:', e?.message || e);
    return res.status(500).json({ error: 'Failed to delete account data' });
  }
});

function stationChannelUrl(provider, channelId, handle) {
  const normalizedProvider = String(provider || '').toLowerCase();
  const normalizedChannelId = String(channelId || '').trim();
  const normalizedHandle = String(handle || '').trim().replace(/^@/, '');
  if (normalizedProvider === 'cime') {
    const cimeId = normalizedHandle || normalizedChannelId.replace(/^@/, '');
    if (cimeId) return `https://ci.me/@${encodeURIComponent(cimeId)}`;
  }
  if (normalizedProvider === 'youtube') {
    if (normalizedHandle) {
      const handlePath = normalizedHandle.startsWith('@') ? normalizedHandle : `@${normalizedHandle}`;
      return `https://www.youtube.com/${encodeURIComponent(handlePath).replace('%40', '@')}`;
    }
    if (normalizedChannelId) return `https://www.youtube.com/channel/${encodeURIComponent(normalizedChannelId)}`;
  }
  if (normalizedChannelId) return `https://chzzk.naver.com/${encodeURIComponent(normalizedChannelId)}`;
  return null;
}

function normalizeStationChannel(account, fallbackProvider = null) {
  const provider = String(account?.provider || fallbackProvider || '').toLowerCase();
  const channelId = String(account?.channel_id || account?.channelId || account?.platform_user_id || account?.platformUserId || '').trim();
  const channelHandle = String(account?.channel_handle || account?.channelHandle || '').trim();
  const url = provider === 'cime'
    ? stationChannelUrl(provider, channelId, channelHandle) || account?.url
    : account?.url || stationChannelUrl(provider, channelId, channelHandle);
  const metadata = account?.metadata && typeof account.metadata === 'object' ? account.metadata : {};
  const publicProfile = metadata.publicProfile && typeof metadata.publicProfile === 'object' ? metadata.publicProfile : {};
  if (!url) return null;
  return {
    provider: provider || 'chzzk',
    platformUserId: account?.platform_user_id || account?.platformUserId || channelId,
    channelId,
    channelName: account?.channel_name || account?.channelName || channelHandle || channelId,
    channelHandle: channelHandle || null,
    avatarUrl: account?.avatar_url || account?.avatarUrl || account?.profile_image_url || account?.profileImageUrl || null,
    live: publicProfile.isLive === true ? true : null,
    liveTitle: publicProfile.liveTitle || publicProfile.title || null,
    url,
  };
}

async function getViewerPlatformLiveState(ownerUserId, account = {}) {
  const provider = String(account?.provider || '').toLowerCase();
  const channelId = String(account?.channel_id || account?.channelId || account?.platform_user_id || account?.platformUserId || '').trim();
  if (!ownerUserId || !provider || !channelId) return null;
  const key = `${ownerUserId}:${provider}:${channelId}`;
  const cached = viewerPlatformLiveCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value = null;
  const sid = `user:${ownerUserId}`;
  try {
    if (provider === 'chzzk') {
      const state = await refreshChzzkLiveStatusForSid(sid, { channelUids: [channelId], ttlMs: 15_000 }).catch(() => null);
      value = state ? { live: state.live === true, title: state.title || null, provider, channelId } : null;
    } else if (provider === 'cime') {
      const live = await refreshCimeLiveStatus(ownerUserId, sid, channelId).catch(() => null);
      const state = liveStatusCache.get(sid);
      value = live == null ? null : { live: live === true, title: state?.provider === 'cime' ? state.title || null : null, provider, channelId };
    } else if (provider === 'youtube') {
      const state = await refreshYoutubeLiveStatus(ownerUserId, sid, { force: false }).catch(() => null);
      value = state ? { live: state.live === true, title: state.title || null, provider, channelId } : null;
    }
  } catch {
    value = null;
  }
  const metadata = account?.metadata && typeof account.metadata === 'object' ? account.metadata : {};
  const publicProfile = metadata.publicProfile && typeof metadata.publicProfile === 'object' ? metadata.publicProfile : {};
  if (!value && publicProfile.isLive === true) {
    value = { live: true, title: publicProfile.liveTitle || publicProfile.title || null, provider, channelId };
  }
  viewerPlatformLiveCache.set(key, { expiresAt: Date.now() + 15_000, value });
  if (viewerPlatformLiveCache.size > 500) {
    for (const [cacheKey, entry] of viewerPlatformLiveCache) {
      if (entry.expiresAt <= Date.now() || viewerPlatformLiveCache.size > 420) viewerPlatformLiveCache.delete(cacheKey);
    }
  }
  return value;
}

async function listStationChannelsForViewerBalance(balance) {
  const ownerCandidates = Array.from(new Set([
    balance?.canonicalChannelUid,
    balance?.channelUid,
    String(balance?.canonicalChannelUid || '').replace(/^user:/, ''),
    String(balance?.channelUid || '').replace(/^user:/, ''),
  ].map((value) => String(value || '').trim()).filter(Boolean)));

  for (const ownerId of ownerCandidates) {
    const accounts = await listPlatformAccounts(ownerId).catch(() => []);
    const channels = await Promise.all((accounts || []).map(async (account) => {
      const channel = normalizeStationChannel(account);
      if (!channel) return null;
      const liveState = await getViewerPlatformLiveState(ownerId, account).catch(() => null);
      return {
        ...channel,
        live: liveState?.live ?? channel.live ?? false,
        liveTitle: liveState?.title || channel.liveTitle || null,
      };
    }));
    const filteredChannels = channels.filter(Boolean);
    if (filteredChannels.length) {
      const seen = new Set();
      return filteredChannels.filter((channel) => {
        const key = `${channel.provider}:${channel.channelId || channel.url}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  }

  const fallback = normalizeStationChannel({
    provider: balance?.provider || 'chzzk',
    channel_id: balance?.channelUid,
    channel_name: balance?.channelName,
    avatar_url: balance?.avatarUrl,
  });
  return fallback ? [fallback] : [];
}

app.get('/api/viewer/points', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });

    const payload = await readRealtimeCached(`viewer:points:${ownerUserId}`, { ttlMs: 5000, staleMs: 30000 }, async () => {
      const platforms = await listPlatformAccounts(ownerUserId).catch(() => []);
      const identityKeys = collectViewerPointIdentityKeys(ownerUserId, platforms);
      const balances = await listViewerPointBalancesForUserIds(identityKeys);
      const stationChannelEntries = await Promise.all(
        balances.map(async (balance) => [balance.channelUid, await listStationChannelsForViewerBalance(balance)])
      );
      const stationChannelsByChannel = new Map(stationChannelEntries);
      const normalizedBalances = balances.map((balance) => ({
        ...balance,
        stationChannels: stationChannelsByChannel.get(balance.channelUid) || [],
        publicLinks: {
          home: `/c/${encodeURIComponent(balance.channelUid)}`,
          commands: `/c/${encodeURIComponent(balance.channelUid)}/commands`,
          points: `/c/${encodeURIComponent(balance.channelUid)}/points`,
          roulette: `/c/${encodeURIComponent(balance.channelUid)}/roulette`,
        },
      }));

      return {
        userId: ownerUserId,
        platforms,
        viewerIdentity: {
          arubotUuid: makeArubotViewerUuid(ownerUserId),
          identityKeys,
        },
        balances: normalizedBalances,
        totalPoints: normalizedBalances.reduce((sum, balance) => sum + Number(balance.points || 0), 0),
        updatedAt: new Date().toISOString(),
      };
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.json(payload);
  } catch (e) {
    console.error('[Viewer Points] Failed to load viewer balances:', e?.message || e);
    return res.status(500).json({ error: 'Failed to load viewer points' });
  }
});

app.post('/api/account/platforms/refresh', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const providerFilter = req.body?.provider ? String(req.body.provider).toLowerCase() : null;
    if (providerFilter && !['chzzk', 'cime', 'youtube'].includes(providerFilter)) {
      return res.status(400).json({ error: 'Unsupported provider' });
    }
    const platforms = await listPlatformAccounts(ownerUserId).catch(() => []);
    const refreshed = [];
    const errors = [];

    for (const account of platforms) {
      const provider = String(account.provider || '').toLowerCase();
      if (providerFilter && provider !== providerFilter) continue;
      const profile = {
        platformUserId: account.platform_user_id,
        channelId: account.channel_id || account.platform_user_id,
        channelName: account.channel_name || null,
        channelHandle: account.channel_handle || null,
        channelImageUrl: account.avatar_url || null,
        metadata: account.metadata || {}
      };
      try {
        let enriched = profile;
        if (provider === 'chzzk') {
          enriched = await platformProfiles.enrichChzzkProfile(profile, { forceRefresh: true });
        } else if (provider === 'cime') {
          let accessToken = null;
          try { accessToken = await getValidCimeAccessToken(ownerUserId); } catch { }
          enriched = await platformProfiles.enrichCimeProfile(profile, accessToken, { forceRefresh: true });
        } else if (provider === 'youtube') {
          enriched = await fetchYoutubeMyChannel(ownerUserId);
        } else {
          enriched = {
            ...profile,
            metadata: {
              ...(profile.metadata || {}),
              publicProfile: {
                ...(profile.metadata?.publicProfile || {}),
                provider,
                status: 'skipped',
                error: 'unsupported_provider',
                fetchedAt: new Date().toISOString()
              }
            }
          };
        }
        const updated = await updatePlatformAccountProfile(provider, ownerUserId, account.platform_user_id, enriched);
        if (updated) refreshed.push(updated);
      } catch (error) {
        errors.push({ provider, platformUserId: account.platform_user_id, error: error?.message || 'refresh_failed' });
      }
    }

    const nextPlatforms = await listPlatformAccounts(ownerUserId).catch(() => refreshed);
    return res.json({ userId: ownerUserId, sid: `user:${ownerUserId}`, platforms: nextPlatforms, refreshed, errors });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to refresh platform profiles' });
  }
});

app.get('/api/automations/overview', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const [settings, connections] = await Promise.all([
      getAutomationSettings(ownerUserId).catch(() => ({})),
      listAutomationConnections(ownerUserId).catch(() => [])
    ]);
    const localAgents = await listAutomationLocalAgents(ownerUserId).catch(() => []);
    const soundStorage = listAutomationSoundFiles(ownerUserId);
    const fxAssets = listLocalFxAssetsFromConnections(connections);
    return res.json({
      settings: publicAutomationSettings(settings),
      connections: connections.map(publicAutomationConnection).filter(Boolean),
      localAgents: localAgents.map(publicAutomationAgent).filter(Boolean),
      soundStorage,
      fxAssets: fxAssets.assets,
        supportedConnectors: ['obs', 'tits', 'vtube_studio', 'tts', 'stream_deck_touch_portal', 'http', 'websocket', 'udp', 'fx'],
      disabledConnectors: ['soop', 'ssapi', 'twip']
    });
  } catch (e) {
    console.error('[Automations] overview error', e?.message || e);
    return res.status(500).json({ error: 'Failed to load automation overview' });
  }
});

app.get('/api/action-blueprints', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const blueprints = await listActionBlueprints(ownerUserId);
    return res.json({ blueprints });
  } catch (e) {
    console.error('[Blueprint] list error', e?.message || e);
    return res.status(500).json({ error: 'Failed to load blueprints' });
  }
});

app.get('/api/action-blueprints/:id/runs', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const runs = await listActionBlueprintRuns(ownerUserId, req.params.id, req.query?.limit || 20);
    return res.json({ runs });
  } catch (e) {
    console.error('[Blueprint] runs error', e?.message || e);
    return res.status(500).json({ error: 'Failed to load blueprint runs' });
  }
});

app.get('/api/action-blueprints/:id/versions', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const versions = await listActionBlueprintVersions(ownerUserId, req.params.id, req.query?.limit || 30);
    return res.json({ versions });
  } catch (e) {
    console.error('[Blueprint] versions error', e?.message || e);
    return res.status(500).json({ error: 'Failed to load blueprint versions' });
  }
});

app.get('/api/action-blueprints/runs/:runId/steps', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const steps = await listActionBlueprintRunSteps(ownerUserId, req.params.runId);
    return res.json({ steps });
  } catch (e) {
    console.error('[Blueprint] run steps error', e?.message || e);
    return res.status(500).json({ error: 'Failed to load blueprint run steps' });
  }
});

app.get('/api/action-blueprints/:id', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const blueprint = await getActionBlueprint(ownerUserId, req.params.id);
    if (!blueprint) return res.status(404).json({ error: 'Not found' });
    const runs = await listActionBlueprintRuns(ownerUserId, blueprint.id, 20).catch(() => []);
    return res.json({ blueprint, runs });
  } catch (e) {
    console.error('[Blueprint] get error', e?.message || e);
    return res.status(500).json({ error: 'Failed to load blueprint' });
  }
});

app.post('/api/action-blueprints', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const body = req.body || {};
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
    const edges = Array.isArray(body.edges) ? body.edges : [];
    const validationErrors = validateBlueprintGraph(nodes, edges);
    const blueprint = await upsertActionBlueprint(ownerUserId, {
      id: body.id,
      name: body.name,
      slug: body.slug,
      enabled: body.enabled,
      description: body.description,
      nodes,
      edges,
      viewport: body.viewport
    });
    return res.json({ blueprint, validationErrors });
  } catch (e) {
    console.error('[Blueprint] save error', e?.message || e);
    return res.status(500).json({ error: 'Failed to save blueprint' });
  }
});

app.post('/api/action-blueprints/:id/publish', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const blueprint = await getActionBlueprint(ownerUserId, req.params.id);
    if (!blueprint) return res.status(404).json({ error: 'Not found' });
    const validationErrors = validateBlueprintGraph(blueprint.version?.nodes || [], blueprint.version?.edges || []);
    if (validationErrors.length) return res.status(400).json({ error: 'Blueprint is invalid', validationErrors });
    const published = await publishActionBlueprint(ownerUserId, blueprint.id);
    return res.json({ blueprint: published });
  } catch (e) {
    console.error('[Blueprint] publish error', e?.message || e);
    return res.status(500).json({ error: 'Failed to publish blueprint' });
  }
});

app.post('/api/action-blueprints/:id/versions/:versionId/restore', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const blueprint = await restoreActionBlueprintVersion(ownerUserId, req.params.id, req.params.versionId);
    if (!blueprint) return res.status(404).json({ error: 'Not found' });
    return res.json({ blueprint });
  } catch (e) {
    console.error('[Blueprint] restore error', e?.message || e);
    return res.status(500).json({ error: 'Failed to restore blueprint version' });
  }
});

app.delete('/api/action-blueprints/:id', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const ok = await deleteActionBlueprint(ownerUserId, req.params.id);
    return res.json({ ok });
  } catch (e) {
    console.error('[Blueprint] delete error', e?.message || e);
    return res.status(500).json({ error: 'Failed to delete blueprint' });
  }
});

app.post('/api/action-blueprints/:id/test', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const context = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};
    const user = context.user && typeof context.user === 'object' ? context.user : {};
    const channel = context.channel && typeof context.channel === 'object' ? context.channel : {};
    const trigger = context.trigger && typeof context.trigger === 'object' ? context.trigger : {};
    const result = await executeActionBlueprint(ownerUserId, req.params.id, {
      source: 'manual_test',
      triggerRef: req.params.id,
      user: {
        ...(user || {}),
        userId: user.userId || req.body?.userId || 'test_viewer',
        username: user.username || user.name || req.body?.username || '테스트 시청자',
        name: user.name || user.username || req.body?.username || '테스트 시청자',
        points: user.points ?? req.body?.points ?? 3000
      },
      channel: { ...(channel || {}), channelUid: channel.channelUid || req.body?.channelUid || ownerUserId },
      channelUid: channel.channelUid || req.body?.channelUid || ownerUserId,
      trigger: { ...(trigger || {}), platform: trigger.platform || req.body?.platform || 'chzzk' },
      platform: trigger.platform || req.body?.platform || 'chzzk',
      roulette: context.roulette || req.body?.roulette || {},
      donation: context.donation || req.body?.donation || {},
      attendance: context.attendance || req.body?.attendance || {},
      live: { title: '테스트 방송', viewers: 128, live: true, ...(context.live || {}) },
    });
    return res.json(result);
  } catch (e) {
    console.error('[Blueprint] test error', e?.message || e);
    return res.status(500).json({ error: 'Failed to test blueprint' });
  }
});

app.put('/api/automations/settings', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const body = req.body || {};
    const next = {
        integrationMode: internalExecutionMode(body.integrationMode),
        soundStorageMode: internalSoundStorageMode(body.soundStorageMode),
        tts: {
          enabled: body?.tts?.enabled !== false,
          provider: internalTtsProvider(body?.tts?.provider),
        voice: String(body?.tts?.voice || '').slice(0, 120),
        rate: Math.min(2, Math.max(0.5, Number(body?.tts?.rate || 1))),
        pitch: Math.min(2, Math.max(0.5, Number(body?.tts?.pitch || 1)))
      },
      updatedAt: new Date().toISOString()
    };
    const settings = await setAutomationSettings(ownerUserId, next);
    return res.json({ settings: publicAutomationSettings(settings) });
  } catch (e) {
    console.error('[Automations] settings error', e?.message || e);
    return res.status(500).json({ error: 'Failed to save automation settings' });
  }
});

app.post('/api/automations/local-agents/pair', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const name = String(req.body?.name || 'AruBot Local Program').trim().slice(0, 120) || 'AruBot Local Program';
    const result = await getOrCreateAutomationLocalAgent(ownerUserId, name, { rotate: false });
    return res.json({
      token: result.token || null,
      agent: publicAutomationAgent(result.agent),
      tokenMasked: result.token ? null : 'alp_••••••••••••••••••••••••••••••••',
      tokenShownOnce: !!result.token
    });
  } catch (e) {
    console.error('[Automations] local agent pair error', e?.message || e);
    return res.status(500).json({ error: 'Failed to create local program token' });
  }
});

app.post('/api/automations/local-agents/rotate', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const name = String(req.body?.name || 'AruBot Local Program').trim().slice(0, 120) || 'AruBot Local Program';
    const result = await getOrCreateAutomationLocalAgent(ownerUserId, name, { rotate: true });
    return res.json({
      token: result.token || null,
      agent: publicAutomationAgent(result.agent),
      tokenShownOnce: true
    });
  } catch (e) {
    console.error('[Automations] local agent rotate error', e?.message || e);
    return res.status(500).json({ error: 'Failed to regenerate local program token' });
  }
});

app.get('/api/automations/local-agents', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const agents = await listAutomationLocalAgents(ownerUserId);
    return res.json({ agents: agents.map(publicAutomationAgent).filter(Boolean) });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load local programs' });
  }
});

app.post('/api/automations/local-agent/heartbeat', requireAutomationLocalAgent, async (req, res) => {
  try {
    await touchAutomationLocalAgent(req.automationLocalAgent.id, req.body?.capabilities || {});
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to update local program heartbeat' });
  }
});

app.post('/api/automations/local-agent/discovery-sync', requireAutomationLocalAgent, async (req, res) => {
  try {
    const ownerUserId = req.automationLocalAgent?.ownerUserId;
    if (!ownerUserId) return res.status(401).json({ error: 'Invalid local program token' });
    const type = String(req.body?.type || '').toLowerCase();
    if (!['obs', 'tits', 'vtube_studio', 'fx_assets'].includes(type)) return res.status(400).json({ error: 'Unsupported discovery type' });
    const discoveryCache = req.body?.discoveryCache && typeof req.body.discoveryCache === 'object'
      ? req.body.discoveryCache
      : {};
    const connections = await listAutomationConnections(ownerUserId).catch(() => []);
    const existing = connections.find((connection) => (
      connection?.type === type &&
      (connection?.executionMode === 'local_program' || connection?.execution_mode === 'local_program')
    ));
    const fetchedAt = discoveryCache.fetchedAt || new Date().toISOString();
    const connection = await upsertAutomationConnection(ownerUserId, {
      id: req.body?.connectionId || req.body?.id || existing?.id,
      type,
      name: req.body?.name || existing?.name || (type === 'obs' ? 'OBS Studio' : type === 'vtube_studio' ? 'VTube Studio' : type === 'fx_assets' ? 'FX 로컬 에셋' : 'T.I.T.S.'),
      enabled: true,
      executionMode: 'local_program',
      endpoint: req.body?.endpoint || discoveryCache.endpoint || existing?.endpoint || '',
      config: existing?.config || {},
      capabilities: existing?.capabilities || {},
      discoveryCache,
      discoveryUpdatedAt: fetchedAt,
      lastStatus: 'ok',
      lastCheckedAt: new Date().toISOString()
    });
    await touchAutomationLocalAgent(req.automationLocalAgent.id, req.body?.capabilities || {}).catch(() => null);
    return res.json({ ok: true, connection: publicAutomationConnection(connection) });
  } catch (e) {
    console.error('[Automations] local discovery sync error', e?.message || e);
    return res.status(500).json({ error: 'Failed to sync local discovery' });
  }
});

app.post('/api/automations/local-agent/jobs/claim', requireAutomationLocalAgent, async (req, res) => {
  try {
    await touchAutomationLocalAgent(req.automationLocalAgent.id, req.body?.capabilities || {});
    const jobs = await claimAutomationJobsForAgent(req.automationLocalAgent, req.body?.limit || 5);
    return res.json({ jobs });
  } catch (e) {
    console.error('[Automations] local agent claim error', e?.message || e);
    return res.status(500).json({ error: 'Failed to claim automation jobs' });
  }
});

app.post('/api/automations/local-agent/jobs/:jobId/complete', requireAutomationLocalAgent, async (req, res) => {
  try {
    const job = await completeAutomationJobForAgent(req.automationLocalAgent, req.params.jobId, {
      status: req.body?.status,
      result: req.body?.result || {},
      errorMessage: req.body?.errorMessage || req.body?.error || null
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const discovery = req.body?.result?.discovery;
    const connectionId = job.connectionId || job.connection_id || null;
    const jobType = String(job.jobType || job.job_type || '');
    if (req.body?.status === 'done' && connectionId && discovery && typeof discovery === 'object') {
      const type = jobType.startsWith('vtube.') ? 'vtube_studio'
        : jobType.startsWith('tits.') ? 'tits'
          : jobType.startsWith('obs.') ? 'obs'
          : String(discovery.source || '');
      if (type) {
        await upsertAutomationConnection(req.automationLocalAgent.ownerUserId, {
          id: connectionId,
          type,
          name: type === 'obs' ? 'OBS Studio' : type === 'vtube_studio' ? 'VTube Studio' : type === 'tits' ? 'T.I.T.S.' : type,
          enabled: true,
          executionMode: 'local_program',
          endpoint: discovery.endpoint || '',
          discoveryCache: discovery,
          discoveryUpdatedAt: discovery.fetchedAt || new Date().toISOString(),
          lastStatus: 'ok',
          lastCheckedAt: new Date().toISOString()
        }).catch((error) => console.warn('[Automations] failed to persist local discovery cache', error?.message || error));
      }
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to complete automation job' });
  }
});

app.post('/api/automations/local-agent/fx/push', requireAutomationLocalAgent, async (req, res) => {
  try {
    const ownerUserId = req.automationLocalAgent?.ownerUserId;
    if (!ownerUserId) return res.status(401).json({ error: 'Invalid local program token' });
    const sid = `user:${ownerUserId}`;
    const payload = normalizeFxPayload(req.body?.payload || req.body || {});
    const sent = broadcastFxToSid(sid, payload);
    return res.json({ ok: true, sent, payload: { ...payload, assetUrl: payload.assetUrl ? '[local-url]' : '' } });
  } catch (e) {
    console.error('[FX] local push error', e?.message || e);
    return res.status(500).json({ error: 'Failed to push FX event' });
  }
});

function getLocalRemoteSid(req) {
  const ownerUserId = req.automationLocalAgent?.ownerUserId;
  return ownerUserId ? `user:${ownerUserId}` : null;
}

app.get('/api/local-remote/overview', requireAutomationLocalAgent, async (req, res) => {
  try {
    const sid = getLocalRemoteSid(req);
    if (!sid) return res.status(401).json({ error: 'Invalid local program token' });
    const settings = await getBotSettings(sid) || {};
    const rules = await getBotRulesWithDefaults(sid).catch(() => []);
    const rouletteDefs = getRouletteDefsFromSettings(settings);
    const videoQueue = getVideoQueue(sid);
    const drawingQueue = await listDrawingQueueForSid(sid).catch(() => []);
    return res.json({
      rules,
      rouletteDefs,
      videoQueue,
      drawingQueue,
      settings: {
        botEnabled: settings.botEnabled !== false,
        videoDonationAcceptEnabled: settings.videoDonationAcceptEnabled === true,
        videoDonationVolume: normalizePvdVolume(settings.videoDonationVolume ?? 100),
        drawingDonation: normalizeDrawingDonationSettings(settings.drawingDonation),
      },
    });
  } catch (e) {
    console.error('[Local Remote] overview error', e?.message || e);
    return res.status(500).json({ error: 'Failed to load local remote overview' });
  }
});

app.post('/api/local-remote/commands/upsert', requireAutomationLocalAgent, async (req, res) => {
  try {
    const sid = getLocalRemoteSid(req);
    if (!sid) return res.status(401).json({ error: 'Invalid local program token' });
    const input = req.body?.rule || {};
    const keywords = Array.isArray(input.keywords) ? input.keywords.map(String).map((item) => item.trim()).filter(Boolean) : [];
    const responses = Array.isArray(input.responses) ? input.responses.map(String).map((item) => item.trim()).filter(Boolean) : [];
    if (!keywords.length) return res.status(400).json({ error: '명령어가 필요합니다.' });
    if (!responses.length) return res.status(400).json({ error: '응답 문구가 필요합니다.' });
    const rule = {
      id: String(input.id || `cmd_${Date.now().toString(36)}`),
      name: String(input.name || keywords[0]).trim(),
      keywords,
      responses,
      enabled: input.enabled !== false,
      adminOnly: input.adminOnly === true,
      requiredRoleLevel: Math.max(0, Number(input.requiredRoleLevel ?? 1)),
      pointsCost: Math.max(0, Number(input.pointsCost || 0)),
      cooldown: Math.max(1000, Number(input.cooldown || 3000)),
      lastUsed: Number(input.lastUsed || 0),
    };
    await upsertBotRule(sid, rule);
    await markDefaultBotRulesInitialized(sid);
    return res.json({ rule });
  } catch (e) {
    console.error('[Local Remote] command upsert error', e?.message || e);
    return res.status(500).json({ error: 'Failed to save command' });
  }
});

app.post('/api/local-remote/commands/delete', requireAutomationLocalAgent, async (req, res) => {
  try {
    const sid = getLocalRemoteSid(req);
    if (!sid) return res.status(401).json({ error: 'Invalid local program token' });
    const id = String(req.body?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    await deleteBotRule(sid, id);
    return res.json({ deleted: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete command' });
  }
});

app.post('/api/local-remote/roulette/test', requireAutomationLocalAgent, async (req, res) => {
  try {
    const sid = getLocalRemoteSid(req);
    if (!sid) return res.status(401).json({ error: 'Invalid local program token' });
    const settings = await getBotSettings(sid) || {};
    const definitions = getRouletteDefsFromSettings(settings);
    const id = String(req.body?.id || '').trim();
    const name = String(req.body?.name || '').trim();
    const definition = definitions.find((item) => (
      (id && String(item?.id || '') === id) ||
      (name && String(item?.name || '').trim().toLowerCase() === name.toLowerCase())
    ));
    if (!definition) return res.status(404).json({ error: '룰렛을 찾을 수 없습니다.' });
    const result = await startRouletteSpin(sid, definition.name, 'arubot_local_remote', '로컬 리모컨', { instant: true, suppressResultChat: true });
    return res.json({ result });
  } catch (e) {
    console.error('[Local Remote] roulette test error', e?.message || e);
    return res.status(500).json({ error: 'Failed to test roulette' });
  }
});

app.post('/api/local-remote/video-donation/pop', requireAutomationLocalAgent, async (req, res) => {
  try {
    const sid = getLocalRemoteSid(req);
    if (!sid) return res.status(401).json({ error: 'Invalid local program token' });
    const expectedItemId = String(req.body?.itemId || req.body?.expectedItemId || '').trim();
    const { popped, queue, mismatch, head } = await popCurrentVideoDonationItem(sid, {
      cause: req.body?.cause || 'local_remote',
      expectedItemId,
      refundOnError: false,
    });
    if (popped) {
      try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
      await broadcastPvdStart(sid);
    }
    return res.json({ item: popped, queue, mismatch: mismatch === true, currentItem: head || queue[0] || null });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to pop video donation queue' });
  }
});

app.post('/api/local-remote/video-donation/control', requireAutomationLocalAgent, async (req, res) => {
  try {
    const sid = getLocalRemoteSid(req);
    if (!sid) return res.status(401).json({ error: 'Invalid local program token' });
    const q = getVideoQueue(sid);
    const op = String(req.body?.op || '').toLowerCase();
    if (op === 'volume') {
      const volume = normalizePvdVolume(req.body?.volume ?? req.body?.value ?? 100);
      const settings = await getBotSettings(sid) || {};
      await setBotSettings(sid, { ...settings, videoDonationVolume: volume });
      const message = await broadcastPvdControl(sid, { op, volume });
      return res.json({ ok: true, message });
    }
    if (!q[0]) return res.json({ ok: true, empty: true });
    if (op === 'duration' || op === 'duration_sync') {
      const durationSec = Number(req.body?.durationSec ?? req.body?.duration ?? req.body?.value);
      const item = updateCurrentPvdDurationFromPlayer(sid, durationSec);
      if (!item) return res.status(400).json({ error: 'invalid duration' });
      return res.json({ ok: true, item });
    }
    let atSec = Number(req.body?.atSec);
    if (!Number.isFinite(atSec) || atSec < 0) atSec = getCurrentAtSec(sid);
    let state = pvdPlaybackState.get(sid);
    if (!state) { state = createPvdPlaybackState(q[0]); pvdPlaybackState.set(sid, state); }
    if (op === 'pause') {
      state.paused = true; state.pausedAtSec = Math.floor(atSec);
    } else if (op === 'play') {
      state.paused = false; setPvdPlaybackBaseFromAtSec(state, q[0], atSec); state.pausedAtSec = null;
    } else if (op === 'seek') {
      if (state.paused) state.pausedAtSec = Math.floor(atSec);
      else setPvdPlaybackBaseFromAtSec(state, q[0], atSec);
    } else {
      return res.status(400).json({ error: 'invalid op' });
    }
    try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
    scheduleNextPvdAutoPop(sid);
    const message = await broadcastPvdControl(sid, { op, atSec: Math.floor(atSec), paused: state.paused === true });
    return res.json({ ok: true, message });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to control video donation playback' });
  }
});

app.post('/api/local-remote/drawing-donation/approve', requireAutomationLocalAgent, async (req, res) => {
  try {
    const sid = getLocalRemoteSid(req);
    if (!sid) return res.status(401).json({ error: 'Invalid local program token' });
    const id = String(req.body?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    const item = await updateDrawingItemStatusForSid(sid, id, 'approved');
    if (!item) return res.status(404).json({ error: 'not_found' });
    await recordBotEventLogSafe(sid, {
      category: 'drawing_donation',
      eventType: 'drawing_donation_local_approve',
      provider: 'local_program',
      channelUid: item.channelUid,
      viewerUserId: item.viewerUserId,
      viewerName: item.viewerName,
      pointDelta: 0,
      targetName: '그림 후원',
      summary: '로컬 리모컨에서 그림 후원을 승인',
      status: 'success',
      metadata: { drawingId: item.id },
    });
    notifyDrawingSubscribers(sid, 'approved').catch(() => null);
    notifyDrawingAdminSubscribers(sid, 'approved').catch(() => null);
    return res.json({ ok: true, item, items: await listDrawingQueueForSid(sid).catch(() => []) });
  } catch (e) {
    console.error('[Local Remote] drawing approve error', e?.message || e);
    return res.status(500).json({ error: 'Failed to approve drawing donation' });
  }
});

app.post('/api/local-remote/drawing-donation/reject', requireAutomationLocalAgent, async (req, res) => {
  try {
    const sid = getLocalRemoteSid(req);
    if (!sid) return res.status(401).json({ error: 'Invalid local program token' });
    const id = String(req.body?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    let item = await getDrawingItemForSid(sid, id, { includeStrokes: true });
    if (!item) return res.status(404).json({ error: 'not_found' });
    let refundedAmount = 0;
    if (!item.pointRefunded) {
      for (const deduction of item.pointDeductions || []) {
        await incrChannelPoints(item.channelUid, deduction.userId, deduction.username || item.viewerName || null, Number(deduction.amount || 0)).catch(() => null);
        refundedAmount += Number(deduction.amount || 0);
      }
      item.pointRefunded = true;
    }
    item = await updateDrawingItemStatusForSid(sid, id, 'rejected', { pointRefunded: true }) || item;
    if (refundedAmount > 0) {
      await recordBotEventLogSafe(sid, {
        category: 'drawing_donation',
        eventType: 'drawing_donation_local_reject_refund',
        provider: 'local_program',
        channelUid: item.channelUid,
        viewerUserId: item.viewerUserId,
        viewerName: item.viewerName,
        pointDelta: refundedAmount,
        targetName: '그림 후원',
        summary: `로컬 리모컨에서 그림 후원을 거절하고 ${refundedAmount}P를 반환`,
        status: 'refunded',
        metadata: { drawingId: item.id },
      });
    }
    notifyDrawingSubscribers(sid, 'rejected').catch(() => null);
    notifyDrawingAdminSubscribers(sid, 'rejected').catch(() => null);
    return res.json({ ok: true, item, refundedAmount, items: await listDrawingQueueForSid(sid).catch(() => []) });
  } catch (e) {
    console.error('[Local Remote] drawing reject error', e?.message || e);
    return res.status(500).json({ error: 'Failed to reject drawing donation' });
  }
});

app.post('/api/local-remote/drawing-donation/delete-refund', requireAutomationLocalAgent, async (req, res) => {
  try {
    const sid = getLocalRemoteSid(req);
    if (!sid) return res.status(401).json({ error: 'Invalid local program token' });
    const id = String(req.body?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    let item = await getDrawingItemForSid(sid, id, { includeStrokes: true });
    if (!item) return res.status(404).json({ error: 'not_found' });
    let refundedAmount = 0;
    if (!item.pointRefunded) {
      for (const deduction of item.pointDeductions || []) {
        await incrChannelPoints(item.channelUid, deduction.userId, deduction.username || item.viewerName || null, Number(deduction.amount || 0)).catch(() => null);
        refundedAmount += Number(deduction.amount || 0);
      }
      item.pointRefunded = true;
    }
    item = await deleteDrawingItemForSid(sid, id) || item;
    if (refundedAmount > 0) {
      await recordBotEventLogSafe(sid, {
        category: 'drawing_donation',
        eventType: 'drawing_donation_local_delete_refund',
        provider: 'local_program',
        channelUid: item.channelUid,
        viewerUserId: item.viewerUserId,
        viewerName: item.viewerName,
        pointDelta: refundedAmount,
        targetName: '그림 후원',
        summary: `로컬 리모컨에서 그림 후원을 삭제하고 ${refundedAmount}P를 반환`,
        status: 'refunded',
        metadata: { drawingId: item.id },
      });
    }
    notifyDrawingSubscribers(sid, 'deleted_refunded').catch(() => null);
    notifyDrawingAdminSubscribers(sid, 'deleted_refunded').catch(() => null);
    return res.json({ ok: true, item, refundedAmount, items: await listDrawingQueueForSid(sid).catch(() => []) });
  } catch (e) {
    console.error('[Local Remote] drawing delete error', e?.message || e);
    return res.status(500).json({ error: 'Failed to delete drawing donation' });
  }
});

app.post('/api/local-remote/drawing-donation/pop', requireAutomationLocalAgent, async (req, res) => {
  try {
    const sid = getLocalRemoteSid(req);
    if (!sid) return res.status(401).json({ error: 'Invalid local program token' });
    const current = await getCurrentDrawingItemForSid(sid);
    if (!current) return res.json({ item: null, items: await listDrawingQueueForSid(sid).catch(() => []) });
    const item = await updateDrawingItemStatusForSid(sid, current.id, 'done') || current;
    await recordBotEventLogSafe(sid, {
      category: 'drawing_donation',
      eventType: 'drawing_donation_local_done',
      provider: 'local_program',
      channelUid: item.channelUid,
      viewerUserId: item.viewerUserId,
      viewerName: item.viewerName,
      pointDelta: 0,
      targetName: '그림 후원',
      summary: '로컬 리모컨에서 다음 그림 후원으로 넘김',
      status: 'success',
      metadata: { drawingId: item.id },
    });
    notifyDrawingSubscribers(sid, 'done').catch(() => null);
    notifyDrawingAdminSubscribers(sid, 'done').catch(() => null);
    return res.json({ ok: true, item, items: await listDrawingQueueForSid(sid).catch(() => []) });
  } catch (e) {
    console.error('[Local Remote] drawing pop error', e?.message || e);
    return res.status(500).json({ error: 'Failed to pop drawing donation' });
  }
});

app.get('/api/automations/connections', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const connections = await listAutomationConnections(ownerUserId);
    return res.json({ connections: connections.map(publicAutomationConnection).filter(Boolean) });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load automation connections' });
  }
});

app.post('/api/automations/connections', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const type = String(req.body?.type || '').toLowerCase();
    if (['soop', 'soop_openapi', 'soop_extension', 'ssapi', 'twip', 'twip_toonation_alertbox'].includes(type)) {
      return res.status(400).json({ error: 'Unsupported connector for this product plan' });
    }
    const existingConnections = req.body?.id ? await listAutomationConnections(ownerUserId).catch(() => []) : [];
    const existingConnection = existingConnections.find((item) => item.id === req.body.id) || null;
    const connection = await upsertAutomationConnection(ownerUserId, {
      id: req.body?.id,
      type,
      name: req.body?.name,
      enabled: req.body?.enabled !== false,
      executionMode: internalExecutionMode(req.body?.executionMode, 'local_program'),
      endpoint: req.body?.endpoint,
      config: existingConnection?.config || {},
      capabilities: existingConnection?.capabilities || {},
      discoveryCache: req.body?.discoveryCache || existingConnection?.discoveryCache || {},
      discoveryUpdatedAt: req.body?.discoveryUpdatedAt || null
    });
    return res.json({ connection: publicAutomationConnection(connection) });
  } catch (e) {
    console.error('[Automations] connection save error', e?.message || e);
    return res.status(500).json({ error: 'Failed to save automation connection' });
  }
});

app.delete('/api/automations/connections/:id', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const deleted = await deleteAutomationConnection(ownerUserId, req.params.id);
    return res.json({ deleted });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete automation connection' });
  }
});

app.post('/api/automations/obs/discover', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const endpoint = String(req.body?.endpoint || 'ws://localhost:4455').trim();
    const connectionId = req.body?.connectionId || null;
    const job = await queueAutomationJob(ownerUserId, {
      connectionId,
      jobType: 'obs.discover',
      payload: { endpoint }
    });
    return res.json({ queued: true, message: '로컬 프로그램이 OBS 장면과 소스 목록을 가져오도록 요청했습니다.' });
  } catch (e) {
    console.error('[Automations] OBS discover error', e?.message || e);
    return res.status(500).json({ error: 'OBS 목록 불러오기를 요청하지 못했습니다.' });
  }
});

app.post('/api/automations/tits/discover', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const executionMode = internalExecutionMode(req.body?.executionMode, 'oracle_direct');
    const endpoint = String(req.body?.endpoint || 'ws://localhost:42069').trim();
    const connectionId = req.body?.connectionId || null;
    if (executionMode === 'local_program') {
      const job = await queueAutomationJob(ownerUserId, {
        connectionId,
        jobType: 'tits.discover',
        payload: { endpoint, sendImage: req.body?.sendImage !== false }
      });
      return res.json({ queued: true, message: '로컬 프로그램이 T.I.T.S. 목록을 가져오도록 요청했습니다.' });
    }
    const [itemResponse, triggerResponse] = await Promise.all([
      sendTitsRequest(endpoint, 'TITSItemListRequest', { sendImage: req.body?.sendImage !== false }),
      sendTitsRequest(endpoint, 'TITSTriggerListRequest')
    ]);
    const discoveryCache = {
      source: 'tits',
      endpoint: getTitsEndpoint(endpoint, 'data'),
      items: normalizeTitsItems(itemResponse),
      triggers: normalizeTitsTriggers(triggerResponse),
      fetchedAt: new Date().toISOString()
    };
    if (connectionId) {
      await upsertAutomationConnection(ownerUserId, {
        id: connectionId,
        type: 'tits',
        name: req.body?.name || 'T.I.T.S.',
        enabled: true,
        executionMode,
        endpoint,
        discoveryCache,
        discoveryUpdatedAt: discoveryCache.fetchedAt,
        lastStatus: 'ok',
        lastCheckedAt: discoveryCache.fetchedAt
      }).catch(() => null);
    }
    return res.json({ discovery: publicAutomationDiscovery(discoveryCache) });
  } catch (e) {
    console.error('[Automations] TITS discover error', e?.message || e);
    return res.status(502).json({ error: 'T.I.T.S. 연결에 실패했습니다.', details: e?.message || String(e) });
  }
});

app.post('/api/automations/tits/throw', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const executionMode = internalExecutionMode(req.body?.executionMode, 'oracle_direct');
    const payload = {
      items: Array.isArray(req.body?.items) ? req.body.items.map(String).filter(Boolean) : [],
      delayTime: Math.min(5, Math.max(0.01, Number(req.body?.delayTime || 0.05))),
      amountOfThrows: Math.min(500, Math.max(1, Number(req.body?.amountOfThrows || 1))),
      errorOnMissingID: !!req.body?.errorOnMissingID
    };
    if (!payload.items.length) return res.status(400).json({ error: 'items is required' });
    if (executionMode === 'local_program') {
      await queueAutomationJob(ownerUserId, { connectionId: req.body?.connectionId || null, jobType: 'tits.throw', payload });
      return res.json({ queued: true });
    }
    const response = await sendTitsRequest(req.body?.endpoint || 'ws://localhost:42069', 'TITSThrowItemsRequest', payload);
    return res.json({ response });
  } catch (e) {
    return res.status(502).json({ error: 'T.I.T.S. 아이템 던지기에 실패했습니다.', details: e?.message || String(e) });
  }
});

app.post('/api/automations/tits/trigger', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const executionMode = internalExecutionMode(req.body?.executionMode, 'oracle_direct');
    const payload = {
      triggerID: String(req.body?.triggerID || req.body?.triggerId || ''),
      triggerName: String(req.body?.triggerName || '')
    };
    if (!payload.triggerID && !payload.triggerName) return res.status(400).json({ error: 'triggerID or triggerName is required' });
    if (executionMode === 'local_program') {
      await queueAutomationJob(ownerUserId, { connectionId: req.body?.connectionId || null, jobType: 'tits.trigger', payload });
      return res.json({ queued: true });
    }
    const response = await sendTitsRequest(req.body?.endpoint || 'ws://localhost:42069', 'TITSTriggerActivateRequest', payload);
    return res.json({ response });
  } catch (e) {
    return res.status(502).json({ error: 'T.I.T.S. 트리거 실행에 실패했습니다.', details: e?.message || String(e) });
  }
});

app.post('/api/automations/vtube/discover', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const executionMode = internalExecutionMode(req.body?.executionMode, 'local_program');
    const endpoint = String(req.body?.endpoint || 'ws://localhost:8001').trim();
    const connectionId = req.body?.connectionId || null;
    if (executionMode === 'local_program') {
      const job = await queueAutomationJob(ownerUserId, {
        connectionId,
        jobType: 'vtube.discover',
        payload: { endpoint }
      });
      return res.json({ queued: true, message: '로컬 프로그램이 VTube Studio 목록을 가져오도록 요청했습니다.' });
    }
    const discoveryCache = await discoverVtubeStudio(endpoint);
    if (connectionId) {
      await upsertAutomationConnection(ownerUserId, {
        id: connectionId,
        type: 'vtube_studio',
        name: req.body?.name || 'VTube Studio',
        enabled: true,
        executionMode,
        endpoint,
        discoveryCache,
        discoveryUpdatedAt: discoveryCache.fetchedAt,
        lastStatus: 'ok',
        lastCheckedAt: discoveryCache.fetchedAt
      }).catch(() => null);
    }
    return res.json({ discovery: publicAutomationDiscovery(discoveryCache) });
  } catch (e) {
    console.error('[Automations] VTube Studio discover error', e?.message || e);
    return res.status(502).json({ error: 'VTube Studio 연결에 실패했습니다.', details: e?.message || String(e) });
  }
});

app.post('/api/automations/vtube/hotkey', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const executionMode = internalExecutionMode(req.body?.executionMode, 'local_program');
    const payload = {
      endpoint: String(req.body?.endpoint || 'ws://localhost:8001').trim(),
      hotkeyId: String(req.body?.hotkeyId || req.body?.hotkeyID || '').trim(),
      hotkeyName: String(req.body?.hotkeyName || '').trim(),
      itemInstanceId: String(req.body?.itemInstanceId || req.body?.itemInstanceID || '').trim()
    };
    if (!payload.hotkeyId && !payload.hotkeyName) return res.status(400).json({ error: 'hotkeyId or hotkeyName is required' });
    if (executionMode === 'local_program') {
      await queueAutomationJob(ownerUserId, { connectionId: req.body?.connectionId || null, jobType: 'vtube.hotkey', payload });
      return res.json({ queued: true });
    }
    const response = await sendVtubeRequest(payload.endpoint, 'HotkeyTriggerRequest', {
      hotkeyID: payload.hotkeyId || payload.hotkeyName,
      itemInstanceID: payload.itemInstanceId
    });
    return res.json({ response });
  } catch (e) {
    return res.status(502).json({ error: 'VTube Studio 핫키 실행에 실패했습니다.', details: e?.message || String(e) });
  }
});

app.post('/api/automations/toonation/test', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const executionMode = internalExecutionMode(req.body?.executionMode, 'oracle_direct');
    if (executionMode === 'local_program') {
      const job = await queueAutomationJob(ownerUserId, {
        connectionId: req.body?.connectionId || null,
        jobType: 'toonation.alertbox.test',
        payload: { keyStorage: 'local', eventTypes: ['donation'] }
      });
      return res.json({ queued: true });
    }
    return res.status(409).json({
      error: 'Toonation alertbox key is stored locally by design.',
      action: 'local_secret_required',
      message: '투네이션 알림 키는 브라우저 또는 로컬 프로그램에만 저장됩니다. 서버 직접 모드에서는 서버에 키를 저장하지 않으므로 테스트할 수 없습니다.'
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to test Toonation connector' });
  }
});

app.post('/api/automations/tts/test', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const text = String(req.body?.text || '아루봇 음성 안내 테스트입니다.').trim().slice(0, 240);
    await queueAutomationJob(ownerUserId, {
      jobType: 'tts.speak',
      payload: {
        text,
        voice: String(req.body?.voice || '').slice(0, 120),
        rate: Math.min(2, Math.max(0.5, Number(req.body?.rate || 1))),
        pitch: Math.min(2, Math.max(0.5, Number(req.body?.pitch || 1)))
      }
    });
    return res.json({ queued: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to queue TTS test' });
  }
});

app.post('/api/automations/sounds/test', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const fileId = path.basename(String(req.body?.fileId || req.body?.name || ''));
    if (!fileId) return res.status(400).json({ error: 'fileId is required' });
    await queueAutomationJob(ownerUserId, {
      jobType: 'fx.play',
      payload: {
        kind: 'sound',
        assetId: fileId,
        fileId,
        volume: Math.min(1, Math.max(0, Number(req.body?.volume ?? 1)))
      }
    });
    return res.json({ queued: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to queue sound test' });
  }
});

app.get('/api/fx/viewer-url', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const sid = `user:${ownerUserId}`;
    const token = await getOrCreateViewerTokenSupabase(ownerUserId, 'fx', sid, 'fx').catch(() => null);
    let finalToken = token;
    if (!finalToken) {
      const settings = await getBotSettings(sid).catch(() => null) || {};
      finalToken = settings.fxViewerToken || `fx_${crypto.randomBytes(18).toString('base64url')}`;
      if (settings.fxViewerToken !== finalToken) {
        await setBotSettings(sid, { ...settings, fxViewerToken: finalToken }).catch(() => null);
      }
    }
    return res.json({ token: finalToken, path: `/fx/${encodeURIComponent(finalToken)}` });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to get FX viewer URL' });
  }
});

app.post('/api/automations/fx/test', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const payload = normalizeFxPayload(req.body || {});
    await queueAutomationJob(ownerUserId, {
      jobType: 'fx.play',
      payload: { ...payload, manualRun: true, requestedAt: new Date().toISOString() }
    });
    return res.json({ queued: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to queue FX test' });
  }
});

app.post('/api/automations/run', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const type = String(req.body?.type || '').toLowerCase();
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    const jobTypes = {
      http: 'blueprint.http',
      obs: 'blueprint.obs',
      websocket: 'blueprint.websocket',
      udp: 'blueprint.udp',
      vtube: 'blueprint.vtube',
      tts: 'tts.speak',
      sound: 'sound.play',
      fx: 'fx.play'
    };
    const jobType = jobTypes[type];
    if (!jobType) return res.status(400).json({ error: 'Unsupported automation run type' });
    await queueAutomationJob(ownerUserId, {
      connectionId: req.body?.connectionId || null,
      jobType,
      payload: {
        ...payload,
        manualRun: true,
        requestedAt: new Date().toISOString()
      }
    });
    return res.json({ queued: true });
  } catch (e) {
    console.error('[Automations] run error', e?.message || e);
    return res.status(500).json({ error: 'Failed to enqueue automation run' });
  }
});

app.get('/api/automations/local-agent/assets/sounds/:fileId', requireAutomationLocalAgent, async (req, res) => {
  try {
    const ownerUserId = req.automationLocalAgent?.ownerUserId;
    if (!ownerUserId) return res.status(401).json({ error: 'Invalid local program token' });
    const fileId = path.basename(String(req.params.fileId || ''));
    const fullPath = path.join(automationSoundDir(ownerUserId), fileId);
    if (!fullPath.startsWith(automationSoundDir(ownerUserId)) || !fs.existsSync(fullPath)) return res.status(404).json({ error: 'Not found' });
    return res.sendFile(fullPath);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to serve sound asset' });
  }
});

app.post('/api/automations/control-links', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const label = String(req.body?.label || '빠른 실행').trim().slice(0, 80) || '빠른 실행';
    const actionId = String(req.body?.actionId || '').trim();
    if (actionId) {
      const blueprint = await getActionBlueprint(ownerUserId, actionId);
      if (!blueprint) return res.status(404).json({ error: 'Action not found' });
      if (!blueprint.version?.published) return res.status(400).json({ error: 'Action must be published before creating a control URL' });
    }
    const token = `ctl_${crypto.randomBytes(32).toString('base64url')}`;
    const connection = await upsertAutomationConnection(ownerUserId, {
      type: 'stream_deck_touch_portal',
      name: label,
      enabled: true,
      executionMode: 'oracle_direct',
      endpoint: `/api/automations/inbound/control/${token}`,
      config: {
        tokenHash: hashControlToken(token),
        tool: 'stream_deck_touch_portal',
        label,
        actionId
      },
      capabilities: { httpPost: true, httpGet: true }
    });
    return res.json({
      connection: publicAutomationConnection(connection),
      url: `${BACKEND_ORIGIN.replace(/\/$/, '')}/api/automations/inbound/control/${token}`,
      method: 'POST'
    });
  } catch (e) {
    console.error('[Automations] control link error', e?.message || e);
    return res.status(500).json({ error: 'Failed to create control link' });
  }
});

app.all('/api/automations/inbound/control/:token', async (req, res) => {
  try {
    const tokenHash = hashControlToken(req.params.token);
    let connection = await findAutomationConnectionByControlTokenHash(tokenHash);
    let ownerUserId = connection?.ownerUserId || null;
    if (!connection) {
      ownerUserId = ownerFromControlToken(req.params.token);
      if (ownerUserId) {
        const connections = await listAutomationConnections(ownerUserId);
        connection = connections.find((item) => item.type === 'stream_deck_touch_portal' && item.config?.tokenHash === tokenHash && item.enabled);
      }
    }
    if (!connection) return res.status(404).json({ error: 'Not found' });
    const actionId = String(connection.config?.actionId || '').trim();
    const context = {
      source: 'external_control',
      triggerRef: connection.id,
      trigger: {
        platform: 'stream_deck_touch_portal',
        method: req.method,
        label: connection.name,
        connectionId: connection.id
      },
      control: {
        label: connection.name,
        method: req.method,
        query: req.query || {},
        body: req.body && typeof req.body === 'object' ? req.body : {},
        at: new Date().toISOString()
      }
    };
    if (actionId) {
      const result = await executeActionBlueprint(ownerUserId, actionId, context);
      return res.json({ ok: result.ok !== false });
    }
    await queueAutomationJob(ownerUserId, {
      connectionId: connection.id,
      jobType: 'control.trigger',
      payload: {
        source: 'stream_deck_touch_portal',
        label: connection.name,
        method: req.method,
        body: req.body && typeof req.body === 'object' ? req.body : {},
        at: new Date().toISOString()
      }
    });
    return res.json({ ok: true, queued: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to enqueue control event' });
  }
});

app.get('/api/automations/assets/sounds', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    return res.json(listAutomationSoundFiles(ownerUserId));
  } catch (e) {
    return res.status(500).json({ error: 'Failed to list sound assets' });
  }
});

app.post('/api/automations/assets/sounds', rateLimiters.userWrite, express.raw({ type: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'application/octet-stream'], limit: '10mb' }), async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length) return res.status(400).json({ error: 'Sound file body is required' });
    if (body.length > AUTOMATION_SOUND_MAX_FILE_BYTES) return res.status(413).json({ error: 'Sound file must be 5MB or less' });
    const current = listAutomationSoundFiles(ownerUserId);
    if (current.usedBytes + body.length > AUTOMATION_SOUND_QUOTA_BYTES) {
      return res.status(413).json({
        error: 'Sound storage quota exceeded',
        quotaBytes: AUTOMATION_SOUND_QUOTA_BYTES,
        usedBytes: current.usedBytes,
        guidance: '10MB를 초과하는 사운드 라이브러리는 AruBot 로컬 프로그램 모드에서 본인 컴퓨터 파일을 직접 호스팅하세요.'
      });
    }
    const originalName = decodeURIComponent(String(req.get('x-file-name') || req.query.name || 'sound.bin'));
    const ext = path.extname(originalName).slice(0, 12) || '.bin';
    const base = sanitizeFileBase(path.basename(originalName, ext));
    const fileId = `${Date.now().toString(36)}_${base}${ext}`;
    const fullPath = path.join(ensureAutomationSoundDir(ownerUserId), fileId);
    fs.writeFileSync(fullPath, body, { flag: 'wx' });
    return res.json({ uploaded: true, soundStorage: listAutomationSoundFiles(ownerUserId) });
  } catch (e) {
    console.error('[Automations] sound upload error', e?.message || e);
    return res.status(500).json({ error: 'Failed to upload sound asset' });
  }
});

app.get('/api/automations/assets/sounds/:fileId', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const fileId = path.basename(String(req.params.fileId || ''));
    const fullPath = path.join(automationSoundDir(ownerUserId), fileId);
    if (!fullPath.startsWith(automationSoundDir(ownerUserId)) || !fs.existsSync(fullPath)) return res.status(404).json({ error: 'Not found' });
    return res.sendFile(fullPath);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to serve sound asset' });
  }
});

app.delete('/api/automations/assets/sounds/:fileId', rateLimiters.userWrite, async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const fileId = path.basename(String(req.params.fileId || ''));
    const fullPath = path.join(automationSoundDir(ownerUserId), fileId);
    if (fullPath.startsWith(automationSoundDir(ownerUserId)) && fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    return res.json({ deleted: true, soundStorage: listAutomationSoundFiles(ownerUserId) });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete sound asset' });
  }
});

// Public API: live status and basic info by channel UID (no auth)
app.get('/api/public/:uid/live', async (req, res) => {
  const uid = String(req.params.uid || '').trim();
  if (!uid) return res.status(400).json({ error: 'uid required' });
  try {
    const payload = await readRealtimeCached(`public:live:${uid}`, { ttlMs: 8000, staleMs: 30000 }, async () => {
      const r = await axiosGetWithRetry(`https://api.chzzk.naver.com/service/v2/channels/${encodeURIComponent(uid)}/live-detail`);
      const content = r?.data?.content || r?.data || {};
      const status = String(content?.status || '').toLowerCase();
      const channelName = content?.channel?.channelName || content?.channel?.name || '';
      const title = content?.liveTitle || content?.title || '';
      const category = content?.liveCategory?.categoryType || content?.categoryType || content?.liveCategoryName || '';
      const viewers = Number(content?.concurrentUserCount || content?.currentViewerCount || 0);
      const startedCandidate = content?.startedAt || content?.started_at || content?.openDate || content?.openTime || content?.openedAt || content?.liveStartAt || content?.startTime || content?.createdAt || null;
      const startedAtTs = parseChzzkLiveTimestamp(startedCandidate, null);
      const startedAt = startedAtTs ? new Date(startedAtTs + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16) : '';
      return { live: isChzzkLiveDetailOpen(content), status, channelName, title, category, viewers, startedAt, startedAtTs, updatedAt: new Date().toISOString() };
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.json(payload);
  } catch (e) {
    return res.json({ live: false });
  }
});

// On-demand: when frontend polls events, also refresh live status in the background
app.use('/api/chzzk/events', async (req, res, next) => {
  try {
    const sid = await getPartitionId(req, res);
    if (sid) {
      // This will update liveStatusCache/liveSession with short TTL
      await isLiveAllowedForSid(sid);
    }
  } catch { }
  next();
});

// Background poller: periodically refresh live status for recently active sids
setInterval(async () => {
  try {
    const now = Date.now();
    for (const [sid, last] of Array.from(activeSids.entries())) {
      // Keep only sids active within the last 15 minutes
      if (now - last > 15 * 60 * 1000) {
        activeSids.delete(sid);
        continue;
      }
      try { await refreshChzzkLiveStatusForSid(sid); } catch { }
    }
  } catch { }
}, LIVE_STATUS_POLL_INTERVAL_MS);

// Public live status endpoint (ignores onlyWhenLive; returns actual channel live state)
app.get('/api/chzzk/live', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    const settings = await getBotSettings(sid) || {};
    let channelUids = await resolveChzzkChannelUidsForSid(sid, settings);
    if (!channelUids.length) return res.json({ live: false });
    const state = await refreshChzzkLiveStatusForSid(sid, { settings, channelUids, force: true });
    return res.json({ live: state.live, channelId: state.channelId, startTs: state.startTs });
  } catch (e) {
    return res.json({ live: false });
  }
});

// --- Per-user bot settings & stats (sid-scoped) ---
app.get('/api/bot/settings', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.json({ settings: {} });
  const settings = await getBotSettings(sid);
  return res.json({ settings });
});

app.post('/api/bot/settings', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  const body = req.body || {};
  const settings = body.settings || {};
  await setBotSettings(sid, settings);
  return res.json({ ok: true });
});

const BOT_VARIABLE_PROVIDERS = ['chzzk', 'cime', 'youtube'];
const BOT_VARIABLES = [
  { key: '{user.name}', label: '시청자 이름', description: '채팅을 보낸 시청자의 표시 이름입니다.', group: '시청자', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{user.id}', label: '시청자 ID', description: '채팅을 보낸 시청자의 플랫폼/아루봇 식별자입니다.', group: '시청자', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{user.username}', label: '시청자 이름', description: '시청자 이름과 같은 값입니다.', group: '시청자', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{user.nickname}', label: '시청자 닉네임', description: '시청자 이름과 같은 값입니다.', group: '시청자', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{user.points}', label: '보유 포인트', description: '현재 채널에서 시청자가 보유한 통합 포인트입니다.', group: '시청자', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{user.channelPoints}', label: '채널 포인트', description: '보유 포인트와 같은 값입니다.', group: '시청자', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{user.attendanceDays}', label: '누적 출석일', description: '현재 채널에서 기록된 누적 출석일입니다.', group: '시청자', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{attendance.streak}', label: '연속 출석일', description: '출석 메시지에서 사용할 수 있는 현재 연속 출석일입니다.', group: '출석', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{attendance.totalDays}', label: '누적 출석일', description: '출석 메시지에서 사용할 수 있는 전체 출석일입니다.', group: '출석', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{attendance.points}', label: '출석 포인트', description: '출석 체크로 지급되는 포인트입니다.', group: '출석', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{attendance.date}', label: '출석 날짜', description: '방송 세션 기준 출석 날짜입니다.', group: '출석', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{user.followedAt}', label: '팔로우 시작일', description: '플랫폼에서 팔로우 날짜를 제공하는 경우 시청자가 팔로우를 시작한 날짜입니다.', group: '시청자', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{user.followedDays}', label: '팔로우 일수', description: '팔로우한 날을 1일째로 계산한 팔로우 일수입니다.', group: '시청자', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{user.subscriptionMonths}', label: '구독 개월', description: '구독 이벤트나 구독 목록에서 확인 가능한 시청자의 구독 개월 수입니다.', group: '시청자', providers: BOT_VARIABLE_PROVIDERS, caveat: '씨미와 YouTube는 구독/멤버십 이벤트를 수신한 시청자부터 채워집니다.' },
  { key: '{live.title}', label: '방송 제목', description: '현재 방송 제목입니다.', group: '방송', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{live.category}', label: '방송 카테고리', description: '현재 방송 카테고리입니다.', group: '방송', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{live.viewers}', label: '시청자 수', description: '확인 가능한 현재 시청자 수입니다.', group: '방송', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{live.startedAt}', label: '방송 시작 시간', description: '현재 방송 시작 시각입니다.', group: '방송', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{live.elapsed}', label: '방송 진행 시간', description: '현재 방송이 진행된 시간입니다.', group: '방송', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{live.elapsed_ko}', label: '방송 진행 시간', description: '한국어 형식으로 표시되는 방송 진행 시간입니다.', group: '방송', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{live.channel}', label: '방송 채널', description: '현재 방송 채널 이름 또는 식별자입니다.', group: '방송', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{channel.followers}', label: '팔로워 수', description: '확인 가능한 현재 채널 팔로워 수입니다.', group: '채널', providers: ['chzzk', 'cime'], caveat: '씨미는 프로필 동기화로 저장된 공개 수치를 사용합니다.' },
  { key: '${video_donation}', label: '영상 후원 신청 실행', description: '명령어 인자로 받은 링크나 검색어를 영상 후원 대기열에 넣고 포인트를 차감합니다.', group: '특수 실행', providers: BOT_VARIABLE_PROVIDERS, caveat: '명령어 응답에 넣으면 채팅에 그대로 출력되지 않고 영상 후원 신청 동작으로 실행됩니다.' },
  { key: '${roulette::룰렛이름}', label: '룰렛 실행', description: '지정한 룰렛을 즉시 실행하고 결과를 채팅/오버레이 흐름에 반영합니다.', group: '특수 실행', providers: BOT_VARIABLE_PROVIDERS, caveat: '룰렛 이름 또는 ID를 :: 뒤에 입력하세요. 예: ${roulette::오늘의 벌칙}' },
  { key: '${action::액션이름}', label: '블루프린트 실행', description: '게시된 실행 액션 블루프린트를 명령어 응답 중 실행합니다.', group: '특수 실행', providers: BOT_VARIABLE_PROVIDERS, caveat: '채팅으로 출력되지 않고 액션이 실행됩니다. 액션 이름, slug 또는 ID를 사용할 수 있습니다.' },
  { key: '${automation::액션이름}', label: '블루프린트 실행 별칭', description: '${action::...}과 같은 방식으로 게시된 실행 액션을 실행합니다.', group: '특수 실행', providers: BOT_VARIABLE_PROVIDERS },
  { key: '${blueprint::액션이름}', label: '블루프린트 실행 별칭', description: '${action::...}과 같은 방식으로 게시된 실행 액션을 실행합니다.', group: '특수 실행', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{trigger.message}', label: '트리거 메시지', description: '블루프린트를 실행시킨 채팅 메시지나 입력 문구입니다.', group: '블루프린트 컨텍스트', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{trigger.keyword}', label: '트리거 키워드', description: '명령어 실행에 매칭된 키워드입니다.', group: '블루프린트 컨텍스트', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{trigger.platform}', label: '트리거 플랫폼', description: '블루프린트를 실행시킨 플랫폼입니다.', group: '블루프린트 컨텍스트', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{user.userId}', label: '시청자 ID', description: '블루프린트와 자동화에서 사용하는 시청자 식별자입니다.', group: '블루프린트 컨텍스트', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{channel.channelUid}', label: '채널 ID', description: '현재 방송인 채널 식별자입니다.', group: '블루프린트 컨텍스트', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{donation.amount}', label: '후원 금액', description: '후원 이벤트로 실행된 블루프린트에서 사용할 수 있는 후원 금액입니다.', group: '블루프린트 컨텍스트', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{roulette.result.label}', label: '룰렛 결과 이름', description: '룰렛 실행 결과의 항목 이름입니다.', group: '룰렛/블루프린트', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{roulette.result.value}', label: '룰렛 결과 값', description: '룰렛 항목에 설정한 실행 액션 또는 값입니다.', group: '룰렛/블루프린트', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{node.rouletteRun.result.label}', label: '룰렛 노드 결과 이름', description: '블루프린트의 룰렛 실행 노드가 만든 결과 항목 이름입니다.', group: '룰렛/블루프린트', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{node.rouletteRun.result.value}', label: '룰렛 노드 결과 값', description: '블루프린트의 룰렛 실행 노드가 만든 결과 값입니다.', group: '룰렛/블루프린트', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{node.attendanceGet.totalDays}', label: '출석 조회 노드 누적일', description: '블루프린트 출석 조회 노드의 누적 출석일 결과입니다.', group: '룰렛/블루프린트', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{node.pointsGet.points}', label: '포인트 조회 노드 결과', description: '블루프린트 포인트 조회 노드가 가져온 포인트입니다.', group: '룰렛/블루프린트', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{node.overlay.overlayId}', label: '오버레이 ID', description: '블루프린트 오버레이 표시 노드가 만든 오버레이 식별자입니다.', group: '룰렛/블루프린트', providers: BOT_VARIABLE_PROVIDERS },
  { key: '{flow.변수이름}', label: '임시 변수', description: '블루프린트 임시 변수 노드에서 저장한 값을 읽습니다. 예: {flow.bonusPoint}', group: '룰렛/블루프린트', providers: BOT_VARIABLE_PROVIDERS },
];

app.get('/api/bot/variables', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  return res.json({ variables: BOT_VARIABLES });
});

app.get('/api/bot/stats', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.json({ stats: { messagesProcessed: 0, commandsHandled: 0, lastActive: null } });
  const stats = await getBotStats(sid);
  return res.json({ stats });
});

app.post('/api/bot/stats/incr', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  const { messagesProcessed = 0, commandsHandled = 0 } = req.body || {};
  const next = await updateBotStats(sid, { messagesProcessed, commandsHandled });
  return res.json({ stats: next });
});

app.get('/api/channel/context', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const context = await getChannelContext(sid);
    if (!context) {
      return res.status(401).json({ error: 'Invalid channel context' });
    }

    return res.json({
      channelId: context.channelId,
      channelName: context.channelId,
      isolated: true,
      sid: context.sid
    });

  } catch (error) {
    console.error('[Channel Context API] Error:', error);
    return res.status(500).json({ error: 'Failed to get channel context' });
  }
});

// --- Per-user bot rules ---
const DEFAULT_BOT_RULES = Object.freeze([
  {
    id: 'default_follow',
    name: '팔로우',
    keywords: ['!팔로우'],
    responses: ['{user.name}님의 팔로우 기록은 {user.followedAt}부터, 함께한 날은 {user.followedDays}일입니다.'],
    enabled: true,
    adminOnly: false,
    requiredRoleLevel: 1,
    pointsCost: 0,
    cooldown: 3000,
    lastUsed: 0,
  },
  {
    id: 'default_uptime',
    name: '업타임',
    keywords: ['!업타임'],
    responses: ['업타임: {live.elapsed_ko}'],
    enabled: true,
    adminOnly: false,
    requiredRoleLevel: 1,
    pointsCost: 0,
    cooldown: 3000,
    lastUsed: 0,
  },
  {
    id: 'default_points',
    name: '포인트',
    keywords: ['!포인트', '!내포인트'],
    responses: ['{user.name}님의 보유 포인트는 {user.points}P입니다.'],
    enabled: true,
    adminOnly: false,
    requiredRoleLevel: 1,
    pointsCost: 0,
    cooldown: 3000,
    lastUsed: 0,
  },
  {
    id: 'default_attendance',
    name: '출석',
    keywords: ['!출석'],
    responses: ['{user.name}님의 누적 출석은 {user.attendanceDays}일입니다.'],
    enabled: true,
    adminOnly: false,
    requiredRoleLevel: 1,
    pointsCost: 0,
    cooldown: 3000,
    lastUsed: 0,
  },
  {
    id: 'default_live_title',
    name: '방송 정보',
    keywords: ['!방제', '!방송'],
    responses: ['현재 방송: {live.title}'],
    enabled: true,
    adminOnly: false,
    requiredRoleLevel: 1,
    pointsCost: 0,
    cooldown: 3000,
    lastUsed: 0,
  },
]);

function createDefaultBotRules() {
  return DEFAULT_BOT_RULES.map((rule) => ({
    ...rule,
    keywords: [...rule.keywords],
    responses: [...rule.responses],
    lastUsed: 0,
  }));
}

async function markDefaultBotRulesInitialized(sid, settings = null) {
  if (!sid) return;
  const current = settings || await getBotSettings(sid).catch(() => ({})) || {};
  if (current.defaultBotRulesInitialized === true) return;
  await setBotSettings(sid, { ...current, defaultBotRulesInitialized: true }).catch((error) => {
    console.warn('[Bot Rules] failed to mark default initialization:', error?.message || error);
  });
}

async function getBotRulesWithDefaults(sid) {
  if (!sid) return [];
  const existingRules = await getBotRules(sid);
  const settings = await getBotSettings(sid).catch(() => ({})) || {};
  if (Array.isArray(existingRules) && existingRules.length > 0) {
    await markDefaultBotRulesInitialized(sid, settings);
    return existingRules;
  }
  if (settings.defaultBotRulesInitialized === true) {
    return [];
  }

  const defaultRules = createDefaultBotRules();
  await Promise.all(defaultRules.map((rule) => upsertBotRule(sid, rule)));
  await markDefaultBotRulesInitialized(sid, settings);

  const seededRules = await getBotRules(sid);
  return Array.isArray(seededRules) && seededRules.length > 0 ? seededRules : defaultRules;
}

app.get('/api/bot/rules', async (req, res) => {
  try {
    const sid = await getBotRulesOwnerSid(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required', rules: [] });
    const rules = await getBotRulesWithDefaults(sid);
    return res.json({ rules });
  } catch (e) {
    console.error('Rule load failed:', e?.message || e, e?.hint || '', e?.details || '');
    return res.status(500).json({ error: 'Failed to load rules', rules: [] });
  }
});

app.post('/api/bot/rules/upsert', async (req, res) => {
  const sid = await getBotRulesOwnerSid(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  const { rule } = req.body || {};
  if (!rule || !rule.id) return res.status(400).json({ error: 'rule with id is required' });

  try {
    if (rule.rouletteDefs && Array.isArray(rule.rouletteDefs)) {
      for (const def of rule.rouletteDefs) {
        if (def.type === 'probability' && Array.isArray(def.items)) {
          const totalPercent = def.items.reduce((sum, item) => sum + (Number(item.probability || 0)), 0);
          const tolerance = 0.001;

          if (Math.abs(totalPercent - 100) > tolerance) {
            const error = totalPercent > 100 ?
              `룰렛 "${def.name}": 확률 합계가 ${totalPercent.toFixed(4)}%로 ${(totalPercent - 100).toFixed(4)}% 초과입니다. 정확히 100%가 되도록 조정해 주세요.` :
              `룰렛 "${def.name}": 확률 합계가 ${totalPercent.toFixed(4)}%로 ${(100 - totalPercent).toFixed(4)}% 부족합니다. 정확히 100%가 되도록 조정해 주세요.`;
            return res.status(400).json({ error: error });
          }
        }
      }
    }

    await upsertBotRule(sid, rule);
    await markDefaultBotRulesInitialized(sid);
    return res.json({ ok: true });
  } catch (e) {
    console.error('Rule upsert failed:', e?.message || e, e?.hint || '', e?.details || '');
    return res.status(500).json({ error: 'Failed to save rule' });
  }
});

app.post('/api/bot/rules/delete', async (req, res) => {
  const sid = await getBotRulesOwnerSid(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  try {
    await deleteBotRule(sid, id);
    return res.json({ ok: true });
  } catch (e) {
    console.error('Rule delete failed:', e?.message || e, e?.hint || '', e?.details || '');
    return res.status(500).json({ error: 'Failed to delete rule' });
  }
});

// --- Channel Points endpoints ---
async function resolveStreamerUidForSid(sid) {
  try {
    const ownerUserId = ownerUserIdFromSid(sid);
    const settings = await getBotSettings(sid) || {};
    let channelUids = await resolveChzzkChannelUidsForSid(sid, settings);
    if (channelUids.length) return channelUids[0];
    for (const provider of ['cime', 'youtube']) {
      const channelId = await resolveChannelIdForOwnerUserId(ownerUserId, { provider, allowFallback: false }).catch(() => null);
      if (channelId) return channelId;
    }
    // fallback via users/me
    const accessToken = await getValidAccessToken(sid);
    const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const content = me?.data?.content || me?.data || {};
    if (content?.channelId) return String(content.channelId);
    if (ownerUserId) return ownerUserId;
  } catch { }
  return null;
}

function parseChannelPointExcludeSet(settings = {}) {
  const fromText = typeof settings.channelPointsExcludeUserIdsText === 'string'
    ? settings.channelPointsExcludeUserIdsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    : [];
  const fromArray = Array.isArray(settings.channelPointsExcludeUserIds)
    ? settings.channelPointsExcludeUserIds.map(String).filter(Boolean)
    : [];
  return new Set([...fromText, ...fromArray].map(String));
}

async function isChannelPointExcluded(settings, userId) {
  const excludedSet = parseChannelPointExcludeSet(settings);
  if (!excludedSet.size) return false;
  const keys = await listPointIdentityKeysForUserId(userId).catch(() => [String(userId || '')]);
  return keys.some((key) => excludedSet.has(String(key)));
}

async function enrichChannelPointRows(rows, settings = {}) {
  const identities = await listPointViewerIdentitySummaries((rows || []).map((row) => row.user_id || row.userId)).catch(() => ({}));
  const excludedSet = parseChannelPointExcludeSet(settings);
  return (rows || []).map((row) => {
    const userId = String(row.user_id || row.userId || '');
    const identity = identities[userId] || {};
    const identityKeys = Array.isArray(identity.identityKeys) && identity.identityKeys.length ? identity.identityKeys : [userId];
    return {
      ...row,
      userId,
      arubotUuid: identity.arubotUuid || null,
      appUserId: identity.appUserId || null,
      platformAccounts: identity.platformAccounts || [],
      identityKeys,
      pointBlocked: identityKeys.some((key) => excludedSet.has(String(key))),
    };
  });
}

function channelPointUserId(row) {
  return String(row?.user_id || row?.userId || '');
}

function channelPointDisplayName(row) {
  return String(row?.username || channelPointUserId(row) || '');
}

function channelPointPlatformAccountCount(row) {
  return Array.isArray(row?.platformAccounts) ? row.platformAccounts.length : 0;
}

function channelPointSearchText(row) {
  const accounts = Array.isArray(row?.platformAccounts) ? row.platformAccounts : [];
  return [
    row?.username,
    row?.user_id,
    row?.userId,
    row?.arubotUuid,
    row?.appUserId,
    ...accounts.flatMap((account) => [
      account?.provider,
      account?.platformUserId,
      account?.channelId,
      account?.nickname,
      account?.handle,
    ]),
  ].map((value) => String(value || '').toLowerCase()).join(' ');
}

function sortChannelPointRows(rows, sortBy = 'points-desc') {
  return [...(rows || [])].sort((a, b) => {
    const aPoints = Number(a?.points || 0);
    const bPoints = Number(b?.points || 0);
    const nameCompare = channelPointDisplayName(a).localeCompare(channelPointDisplayName(b), 'ko-KR', { numeric: true, sensitivity: 'base' });
    if (sortBy === 'points-asc') return aPoints - bPoints || nameCompare;
    if (sortBy === 'name-asc') return nameCompare || bPoints - aPoints;
    if (sortBy === 'name-desc') return -nameCompare || bPoints - aPoints;
    if (sortBy === 'connected-first') return channelPointPlatformAccountCount(b) - channelPointPlatformAccountCount(a) || bPoints - aPoints || nameCompare;
    if (sortBy === 'blocked-first') return Number(b?.pointBlocked === true) - Number(a?.pointBlocked === true) || bPoints - aPoints || nameCompare;
    return bPoints - aPoints || nameCompare;
  });
}

function parseChannelPointListOptions(req) {
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 25) || 25));
  const query = String(req.query.q || req.query.query || '').trim();
  const sortBy = ['points-desc', 'points-asc', 'name-asc', 'name-desc', 'connected-first', 'blocked-first'].includes(String(req.query.sort || ''))
    ? String(req.query.sort)
    : 'points-desc';
  return { page, limit, query, sortBy };
}

async function buildChannelPointListPayload(rows, settings = {}, options = {}) {
  const page = Math.max(1, Number(options.page || 1) || 1);
  const limit = Math.max(1, Math.min(200, Number(options.limit || 25) || 25));
  const query = String(options.query || '').trim().toLowerCase();
  const sortBy = options.sortBy || 'points-desc';
  const total = rows.length;
  const totalPoints = rows.reduce((sum, row) => sum + Number(row?.points || 0), 0);
  const requiresIdentityForList = !!query || sortBy === 'connected-first' || sortBy === 'blocked-first';

  const candidateRows = requiresIdentityForList ? await enrichChannelPointRows(rows, settings) : rows;
  const filteredRows = query
    ? candidateRows.filter((row) => channelPointSearchText(row).includes(query))
    : candidateRows;
  const sortedRows = sortChannelPointRows(filteredRows, sortBy);
  const filteredTotal = sortedRows.length;
  const filteredPoints = sortedRows.reduce((sum, row) => sum + Number(row?.points || 0), 0);
  const totalPages = Math.max(1, Math.ceil(filteredTotal / limit));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * limit;
  const pageRows = sortedRows.slice(start, start + limit);
  const points = requiresIdentityForList ? pageRows : await enrichChannelPointRows(pageRows, settings);

  return {
    points,
    total,
    totalPoints,
    filteredTotal,
    filteredPoints,
    page: currentPage,
    limit,
    totalPages,
    settings: {
      channelPointsPerChat: Math.max(0, Number(settings.channelPointsPerChat ?? 1)),
      channelPointsPerAttendance: Math.max(0, Number(settings.channelPointsPerAttendance || 0)),
      channelPointsExcludeUserIdsText: typeof settings.channelPointsExcludeUserIdsText === 'string' ? settings.channelPointsExcludeUserIdsText : '',
    },
  };
}

async function buildChannelPointPagedListPayload(pageResult, settings = {}, options = {}) {
  const requestedPage = Math.max(1, Number(options.page || 1) || 1);
  const limit = Math.max(1, Math.min(200, Number(options.limit || pageResult?.limit || 25) || 25));
  const total = Number(pageResult?.total || 0);
  const totalPoints = Number(pageResult?.totalPoints || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(requestedPage, totalPages);
  const rows = currentPage === requestedPage
    ? (pageResult?.rows || [])
    : (await listChannelPointsPage(options.channelUid, { offset: (currentPage - 1) * limit, limit })).rows;

  return {
    points: await enrichChannelPointRows(rows, settings),
    total,
    totalPoints,
    filteredTotal: total,
    filteredPoints: totalPoints,
    page: currentPage,
    limit,
    totalPages,
    settings: {
      channelPointsPerChat: Math.max(0, Number(settings.channelPointsPerChat ?? 1)),
      channelPointsPerAttendance: Math.max(0, Number(settings.channelPointsPerAttendance || 0)),
      channelPointsExcludeUserIdsText: typeof settings.channelPointsExcludeUserIdsText === 'string' ? settings.channelPointsExcludeUserIdsText : '',
    },
  };
}

function parsePredictionBetCommand(text) {
  const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
  const command = String(parts[0] || '').toLowerCase();
  if (!['!투표', '!예측', '!베팅', '!배팅', '!prediction', '!bet', '!vote'].includes(command)) return null;
  return {
    command,
    option: parts[1] || '',
    amount: parts[2] || '',
  };
}

function formatPredictionSummary(prediction) {
  if (!prediction) return '열려 있는 예측 베팅이 없습니다.';
  const options = (prediction.options || [])
    .map((option, index) => {
      const odds = option.payoutMultiplier ? ` x${option.payoutMultiplier}` : '';
      return `${index + 1}) ${option.label} ${Number(option.percentage || 0)}%${odds}`;
    })
    .join(' / ');
  return `예측 베팅 진행 중: ${prediction.question} | ${options} | 참여: ${prediction.participantCount}명, 총 ${prediction.totalPoints}P | !투표 번호 포인트`;
}

function formatPredictionBetError(error) {
  const code = String(error?.message || error || '');
  if (code === 'no_open_prediction') return '지금은 열려 있는 예측 베팅이 없습니다.';
  if (code === 'invalid_option') return '선택지를 확인해 주세요. 예: !투표 1 100';
  if (code === 'below_min_bet') return '최소 베팅 포인트보다 적습니다.';
  if (code === 'above_max_bet') return '최대 베팅 포인트를 초과했습니다.';
  if (code === 'option_change_not_allowed') return '이미 선택한 예측은 바꿀 수 없습니다. 같은 선택지에는 추가 베팅할 수 있어요.';
  if (code === 'insufficient_points') return `포인트가 부족합니다. 필요: ${Number(error?.need || 0)}P, 보유: ${Number(error?.have || 0)}P`;
  if (code === 'invalid amount') return '베팅할 포인트를 숫자로 입력해 주세요. 예: !투표 1 100';
  return '예측 베팅 처리 중 오류가 발생했습니다.';
}

async function handlePredictionBetCommand({ sid, channelUid, userId, username, text, provider }) {
  const parsed = parsePredictionBetCommand(text);
  if (!parsed) return null;
  if (!channelUid) return '채널 정보를 확인할 수 없어 예측 베팅을 처리할 수 없습니다.';
  if (!parsed.option || !parsed.amount) {
    const active = await getActivePredictionForChannel(channelUid).catch(() => null);
    return formatPredictionSummary(active);
  }
  try {
    const prediction = await placePredictionBet({
      channelUid,
      userId,
      username,
      optionToken: parsed.option,
      amount: parsed.amount,
    });
    if (sid) {
      await recordPredictionEventLogs(sid, prediction, { provider, channelUid });
    }
    broadcastPredictionSnapshot(prediction?.channelUid || channelUid, prediction, 'prediction:update');
    const optionToken = String(parsed.option || '').trim().toLowerCase();
    const selected = prediction?.options?.find((option, index) => (
      option.id === String(parsed.option) ||
      String(index + 1) === optionToken ||
      option.label.toLowerCase() === optionToken
    ));
    const userBet = prediction?.bets?.find((bet) => String(bet.userId) === String(userId));
    const label = selected?.label || `선택지 ${parsed.option}`;
    const amountText = userBet ? `${Number(userBet.amount || 0)}P 누적` : `${parsed.amount}P`;
    const oddsText = selected?.payoutMultiplier ? ` · 예상 배당 x${selected.payoutMultiplier}` : '';
    return `${username}님, ${label}에 ${amountText} 예측 완료! 현재 총 ${prediction?.totalPoints || 0}P${oddsText}`;
  } catch (error) {
    return formatPredictionBetError(error);
  }
}

// List channel points for the current streamer
app.get('/api/channelpoints', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  const uid = await resolveStreamerUidForSid(sid);
  if (!uid) return res.json({ points: [] });
  try {
    const settings = await getBotSettings(sid) || {};
    const requestedLimit = Number(req.query.limit || 0) || 0;
    if (requestedLimit > 0) {
      const limit = Math.max(1, Math.min(200, requestedLimit));
      const page = Math.max(1, Number(req.query.page || 1) || 1);
      const pageResult = await listChannelPointsPage(uid, { offset: (page - 1) * limit, limit });
      const payload = await buildChannelPointPagedListPayload(pageResult, settings, { page, limit, channelUid: uid });
      return res.json(payload);
    }
    const rows = await listChannelPoints(uid);
    return res.json({ points: await enrichChannelPointRows(rows, settings) });
  } catch (e) {
    console.error('[channelpoints:list] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to list channel points' });
  }
});

app.get('/api/channelpoints/list', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  const uid = await resolveStreamerUidForSid(sid);
  if (!uid) return res.json({ points: [] });
  try {
    const settings = await getBotSettings(sid) || {};
    const options = parseChannelPointListOptions(req);
    if (!options.query && options.sortBy === 'points-desc') {
      const pageResult = await listChannelPointsPage(uid, { offset: (options.page - 1) * options.limit, limit: options.limit });
      return res.json(await buildChannelPointPagedListPayload(pageResult, settings, { ...options, channelUid: uid }));
    }
    const rows = await listChannelPoints(uid);
    return res.json(await buildChannelPointListPayload(rows, settings, options));
  } catch (e) {
    console.error('[channelpoints:list] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to list channel points' });
  }
});

// Set absolute points value
app.post('/api/channelpoints/set', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  const { userId, username, points } = req.body || {};
  if (!userId || points == null) return res.status(400).json({ error: 'userId and points are required' });
  const uid = await resolveStreamerUidForSid(sid);
  if (!uid) return res.status(409).json({ error: 'No streamer channel configured' });
  try {
    await setChannelPoints(uid, String(userId), username ? String(username) : null, Number(points) || 0);
    invalidateRealtimePointCaches(uid);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[channelpoints:set] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to set channel points' });
  }
});

// Increment/decrement points
app.post('/api/channelpoints/incr', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  const { userId, username, delta } = req.body || {};
  if (!userId || delta == null) return res.status(400).json({ error: 'userId and delta are required' });
  const uid = await resolveStreamerUidForSid(sid);
  if (!uid) return res.status(409).json({ error: 'No streamer channel configured' });
  try {
    await incrChannelPoints(uid, String(userId), username ? String(username) : null, Number(delta) || 0);
    invalidateRealtimePointCaches(uid);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[channelpoints:incr] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to update channel points' });
  }
});

// Get a single user's points by userId
// Supports API key or cookie session via getPartitionId
// Response 200: { userId, username, points }
// Response 404: { error: 'Not found' }
app.get('/api/channelpoints/get', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  const userId = String(req.query.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  const channelUid = await resolveStreamerUidForSid(sid);
  if (!channelUid) return res.status(409).json({ error: 'No streamer channel configured' });
  try {
    const hit = await getChannelPointBalanceSummary(channelUid, userId);
    if (!hit?.found) return res.status(404).json({ error: 'Not found' });
    return res.json({ userId, username: hit.username ?? null, points: Number(hit.points || 0) });
  } catch (e) {
    console.error('[channelpoints:get] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to get channel points' });
  }
});

app.get('/api/bot/event-logs', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  try {
    const ownerUserId = ownerUserIdFromSid(sid);
    const result = await listBotEventLogs(ownerUserId, {
      page: req.query.page,
      limit: req.query.limit,
      category: req.query.category,
      provider: req.query.provider,
      q: req.query.q,
      from: req.query.from,
      to: req.query.to,
    });
    return res.json(result);
  } catch (e) {
    console.error('[bot-event-logs:list] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to list event logs' });
  }
});

function getEventLogMetadata(log = {}) {
  return log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
}

function getReplayActionIdsFromLog(log = {}) {
  const metadata = getEventLogMetadata(log);
  const ids = [];
  if (Array.isArray(metadata.actionIds)) ids.push(...metadata.actionIds);
  if (Array.isArray(metadata.actionJobs)) {
    for (const job of metadata.actionJobs) {
      if (job?.actionId) ids.push(job.actionId);
      if (job?.blueprintId) ids.push(job.blueprintId);
    }
  }
  for (const text of [log.result_value, metadata.resultValue, metadata.value]) {
    for (const match of String(text || '').matchAll(/\$\{\s*(?:action|automation|blueprint)::([^}]+)\s*\}/ig)) {
      if (match?.[1]) ids.push(match[1]);
    }
  }
  return Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)));
}

function buildReplayVideoDonationItem(log = {}) {
  const metadata = getEventLogMetadata(log);
  const snapshot = metadata.replaySnapshot && typeof metadata.replaySnapshot === 'object' ? metadata.replaySnapshot : {};
  const mediaProvider = String(snapshot.mediaProvider || metadata.mediaProvider || '').trim();
  const mediaId = String(snapshot.mediaId || metadata.mediaId || '').trim();
  const mediaUrl = String(snapshot.mediaUrl || metadata.mediaUrl || '').trim()
    || (mediaProvider === 'youtube' && mediaId ? `https://www.youtube.com/watch?v=${mediaId}` : '');
  const embedUrl = String(snapshot.embedUrl || metadata.embedUrl || '').trim()
    || (mediaProvider === 'youtube' && mediaId ? `https://www.youtube.com/embed/${mediaId}` : '');
  if (!mediaProvider || (!mediaId && !mediaUrl && !embedUrl)) return null;
  const durationSec = Math.max(1, Math.ceil(Number(snapshot.durationSec || metadata.durationSec || 30) || 30));
  const startSec = Math.max(0, Math.floor(Number(snapshot.startSec ?? metadata.startSec ?? 0) || 0));
  const requestedPlaySec = snapshot.requestedPlaySec ?? metadata.requestedPlaySec ?? null;
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    mediaProvider,
    mediaId,
    mediaUrl: mediaUrl || null,
    embedUrl: embedUrl || mediaUrl || null,
    thumbnailUrl: snapshot.thumbnailUrl || metadata.thumbnailUrl || null,
    videoId: mediaProvider === 'youtube' ? mediaId : null,
    title: snapshot.title || metadata.title || log.target_name || '영상 후원 재생',
    durationSec,
    mediaDurationSec: Number.isFinite(Number(snapshot.mediaDurationSec ?? metadata.mediaDurationSec)) ? Math.ceil(Number(snapshot.mediaDurationSec ?? metadata.mediaDurationSec)) : null,
    awaitDurationSync: false,
    startSec,
    requestedPlaySec: Number.isFinite(Number(requestedPlaySec)) && Number(requestedPlaySec) > 0 ? Math.floor(Number(requestedPlaySec)) : null,
    maxDurationSec: Math.max(durationSec, Number(snapshot.maxDurationSec || metadata.maxDurationSec || durationSec) || durationSec),
    cost: 0,
    userId: log.viewer_user_id ? String(log.viewer_user_id) : 'event-log-replay',
    username: log.viewer_name || '이벤트 로그 재생',
    status: 'queued',
    replay: { fromLogId: log.id || null, originalQueueItemId: metadata.queueItemId || snapshot.id || null }
  };
}

async function replayVideoDonationLog(sid, ownerUserId, log) {
  const item = buildReplayVideoDonationItem(log);
  if (!item) return { ok: false, error: 'video_replay_metadata_missing' };
  const q = getVideoQueue(sid);
  const shouldStartPlayback = q.length === 0;
  q.push(item);
  await recordBotEventLogSafe(sid, {
    category: 'video_donation',
    eventType: 'video_donation_replay',
    provider: 'admin',
    channelUid: log.channel_uid || ownerUserId,
    viewerUserId: log.viewer_user_id || null,
    viewerName: log.viewer_name || null,
    pointDelta: 0,
    targetName: item.title,
    summary: `이벤트 로그에서 영상 후원 재생: ${item.title}`,
    metadata: { replayedFromLogId: log.id, replaySnapshot: item },
  });
  if (shouldStartPlayback) {
    await broadcastPvdStart(sid);
  } else {
    await notifyPvdAdminSubscribers(sid, 'replay_queued').catch(() => null);
  }
  return { ok: true, type: 'video_donation', item };
}

async function replayDrawingDonationLog(sid, ownerUserId, log) {
  const metadata = getEventLogMetadata(log);
  const drawingId = String(metadata.drawingId || metadata.drawing_id || '').trim();
  if (!drawingId) return { ok: false, error: 'drawing_replay_metadata_missing' };
  const source = await getDrawingDonationItem(sid, drawingId, { includeStrokes: true }).catch(() => null);
  if (!source) return { ok: false, error: 'drawing_source_not_found' };
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const item = {
    ...source,
    id,
    ownerSid: sid,
    ownerUserId,
    status: 'approved',
    cost: 0,
    pointDeductions: [],
    pointRefunded: true,
    metrics: { ...(source.metrics || {}), replayedFromLogId: log.id, originalDrawingId: drawingId },
    createdAt: new Date().toISOString(),
    approvedAt: new Date().toISOString(),
    playingAt: null,
    doneAt: null,
  };
  let savedItem = item;
  try {
    savedItem = await insertDrawingDonationItem(item);
  } catch (error) {
    console.warn('[Drawing Donation] replay DB insert failed; using memory fallback:', error?.message || error);
    getDrawingQueue(sid).push(item);
  }
  await recordBotEventLogSafe(sid, {
    category: 'drawing_donation',
    eventType: 'drawing_donation_replay',
    provider: 'admin',
    channelUid: source.channelUid || log.channel_uid || ownerUserId,
    viewerUserId: source.viewerUserId || log.viewer_user_id || null,
    viewerName: source.viewerName || log.viewer_name || null,
    pointDelta: 0,
    targetName: '그림 후원',
    summary: '이벤트 로그에서 그림 후원 재생',
    metadata: { replayedFromLogId: log.id, sourceDrawingId: drawingId, drawingId: savedItem.id },
  });
  await notifyDrawingSubscribers(sid, 'replay_queued').catch(() => null);
  await notifyDrawingAdminSubscribers(sid, 'replay_queued').catch(() => null);
  return { ok: true, type: 'drawing_donation', item: savedItem };
}

async function replayBlueprintActionsFromLog(sid, ownerUserId, log) {
  const actionIds = getReplayActionIdsFromLog(log);
  if (!actionIds.length) return { ok: false, error: 'blueprint_replay_metadata_missing' };
  const provider = String(log.provider || 'admin').toLowerCase();
  const channelUid = log.channel_uid || ownerUserId;
  const results = [];
  for (const actionId of actionIds) {
    const result = await executeActionBlueprint(ownerUserId, actionId, {
      source: 'event_log_replay',
      triggerRef: log.id,
      replayNoCost: true,
      noPointCost: true,
      platform: provider,
      user: {
        userId: log.viewer_user_id || 'event-log-replay',
        username: log.viewer_name || '이벤트 로그 재생',
        name: log.viewer_name || '이벤트 로그 재생',
      },
      channelUid,
      channel: { channelUid },
      trigger: { platform: provider, replayedFromLogId: log.id },
      eventLog: { id: log.id, category: log.category, eventType: log.event_type, summary: log.summary || null },
    });
    results.push({ actionId, result });
  }
  await recordBotEventLogSafe(sid, {
    category: 'command',
    eventType: 'blueprint_replay',
    provider: 'admin',
    channelUid,
    viewerUserId: log.viewer_user_id || null,
    viewerName: log.viewer_name || null,
    pointDelta: 0,
    targetName: actionIds.join(', '),
    summary: `이벤트 로그에서 블루프린트 재생: ${actionIds.join(', ')}`,
    metadata: { replayedFromLogId: log.id, actionIds, results: results.map((item) => ({ actionId: item.actionId, ok: item.result?.ok !== false, runId: item.result?.run?.id || null })) },
  });
  return { ok: true, type: 'blueprint', actionIds, results };
}

async function replayBotEventLog(sid, ownerUserId, log) {
  if (log.category === 'video_donation') return replayVideoDonationLog(sid, ownerUserId, log);
  if (log.category === 'drawing_donation') return replayDrawingDonationLog(sid, ownerUserId, log);
  if (getReplayActionIdsFromLog(log).length) return replayBlueprintActionsFromLog(sid, ownerUserId, log);
  return { ok: false, error: 'replay_not_available' };
}

app.post('/api/bot/event-logs/:id/replay', rateLimiters.userWrite, async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  try {
    const ownerUserId = ownerUserIdFromSid(sid);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const log = await getBotEventLog(ownerUserId, req.params.id);
    if (!log) return res.status(404).json({ error: 'not_found' });
    const result = await replayBotEventLog(sid, ownerUserId, log);
    if (result.ok === false) return res.status(400).json(result);
    return res.json(result);
  } catch (e) {
    console.error('[bot-event-logs:replay] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to replay event log' });
  }
});

// Delete a user's points row
app.post('/api/channelpoints/delete', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  const uid = await resolveStreamerUidForSid(sid);
  if (!uid) return res.status(409).json({ error: 'No streamer channel configured' });
  try {
    await deleteChannelPoints(uid, String(userId));
    invalidateRealtimePointCaches(uid);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[channelpoints:delete] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to delete channel points' });
  }
});

// Export all channel points as JSON (full dump)
app.get('/api/channelpoints/export', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  const uid = await resolveStreamerUidForSid(sid);
  if (!uid) return res.status(409).json({ error: 'No streamer channel configured' });
  try {
    const rows = await listChannelPoints(uid);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="channelpoints-${uid}.json"`);
    return res.send(JSON.stringify(rows, null, 2));
  } catch (e) {
    console.error('[channelpoints:export] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to export channel points' });
  }
});

// Paged export: GET /api/channelpoints/export/page?offset=0&limit=1000
app.get('/api/channelpoints/export/page', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  const uid = await resolveStreamerUidForSid(sid);
  if (!uid) return res.status(409).json({ error: 'No streamer channel configured' });
  const offset = Math.max(0, Number(req.query.offset || 0) || 0);
  const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 1000) || 1000));
  try {
    const page = await listChannelPointsPage(uid, { offset, limit });
    return res.json({ rows: page.rows, total: page.total, totalPoints: page.totalPoints, offset, limit });
  } catch (e) {
    console.error('[channelpoints:export:page] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to export page', detail: String(e?.message || e) });
  }
});

// Import channel points from JSON [{user_id, username, points}, ...]
// Chunked import supported via query params:
//   mode=append|replace (default append)
//   seq=1-based chunk index
//   total=total chunk count (optional)
app.post('/api/channelpoints/import', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  const uid = await resolveStreamerUidForSid(sid);
  if (!uid) return res.status(409).json({ error: 'No streamer channel configured' });
  try {
    const mode = String(req.query.mode || 'append');
    const seq = Number(req.query.seq || 0);
    // If replace mode and this is the first chunk, clear table before upsert
    if (mode === 'replace' && (seq === 1 || req.query.seq === '1')) {
      try { await clearAllChannelPoints(uid); } catch (e) { console.warn('[channelpoints:import] clear for replace failed', e?.message || e); }
    }
    const body = req.body;
    if (!Array.isArray(body)) return res.status(400).json({ error: 'Expected JSON array' });
    const norm = body
      .map((r) => ({ user_id: String(r.user_id || r.userId || ''), username: r.username ?? null, points: Number(r.points || 0) }))
      .filter((r) => r.user_id);
    await bulkUpsertChannelPoints(uid, norm);
    invalidateRealtimePointCaches(uid);
    return res.json({ ok: true, count: norm.length, seq: seq || null });
  } catch (e) {
    console.error('[channelpoints:import] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to import channel points', detail: String(e?.message || e) });
  }
});

// Clear all channel points
app.post('/api/channelpoints/clear', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  const uid = await resolveStreamerUidForSid(sid);
  if (!uid) return res.status(409).json({ error: 'No streamer channel configured' });
  try {
    await clearAllChannelPoints(uid);
    invalidateRealtimePointCaches(uid);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[channelpoints:clear] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to clear channel points', detail: String(e?.message || e) });
  }
});

// --- Prediction betting endpoints ---
app.get('/api/predictions', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  try {
    const predictions = await listPredictionsForSid(sid, Number(req.query.limit || 30));
    return res.json({ predictions });
  } catch (e) {
    console.error('[predictions:list] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to list predictions' });
  }
});

app.get('/api/predictions/active', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  try {
    const channelUid = await resolveStreamerUidForSid(sid);
    if (!channelUid) return res.json({ prediction: null });
    const prediction = await getActivePredictionForChannel(channelUid);
    return res.json({ prediction });
  } catch (e) {
    console.error('[predictions:active] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to get active prediction' });
  }
});

app.post('/api/predictions/create', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  try {
    const channelUid = await resolveStreamerUidForSid(sid);
    if (!channelUid) return res.status(409).json({ error: 'No streamer channel configured' });
    const body = req.body || {};
    const options = Array.isArray(body.options)
      ? body.options
      : String(body.optionsText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (options.length < 2) return res.status(400).json({ error: '예측 선택지는 2개 이상 필요합니다.' });
    const closesAt = body.durationMinutes
      ? new Date(Date.now() + Math.max(1, Number(body.durationMinutes)) * 60 * 1000).toISOString()
      : body.closesAt || null;
    const prediction = await createPrediction({
      sid,
      channelUid,
      question: body.question,
      options,
      minBet: body.minBet,
      maxBet: body.maxBet,
      closesAt,
    });
    schedulePredictionAutoLock(prediction);
    broadcastPredictionSnapshot(prediction.channelUid || channelUid, prediction, 'prediction:update');
    return res.json({ prediction });
  } catch (e) {
    console.error('[predictions:create] error', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to create prediction' });
  }
});

app.post('/api/predictions/:id/lock', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  try {
    const prediction = await lockPredictionForSid(sid, req.params.id);
    if (!prediction) return res.status(404).json({ error: 'Prediction not found' });
    broadcastPredictionSnapshot(prediction.channelUid, prediction, 'prediction:update');
    return res.json({ prediction });
  } catch (e) {
    console.error('[predictions:lock] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to lock prediction' });
  }
});

app.post('/api/predictions/:id/cancel', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  try {
    const prediction = await cancelPredictionForSid(sid, req.params.id);
    if (!prediction) return res.status(404).json({ error: 'Prediction not found' });
    await recordPredictionEventLogs(sid, prediction, { provider: 'admin', channelUid: prediction.channelUid });
    if (predictionAutoLockTimers.has(prediction.id)) {
      clearTimeout(predictionAutoLockTimers.get(prediction.id));
      predictionAutoLockTimers.delete(prediction.id);
    }
    broadcastPredictionClear(prediction.channelUid);
    return res.json({ prediction });
  } catch (e) {
    console.error('[predictions:cancel] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to cancel prediction' });
  }
});

app.post('/api/predictions/:id/settle', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.status(401).json({ error: 'Login required' });
  try {
    const winningOptionId = String(req.body?.winningOptionId || '').trim();
    if (!winningOptionId) return res.status(400).json({ error: 'winningOptionId is required' });
    const prediction = await settlePredictionForSid(sid, req.params.id, winningOptionId);
    if (!prediction) return res.status(404).json({ error: 'Prediction not found' });
    await recordPredictionEventLogs(sid, prediction, { provider: 'admin', channelUid: prediction.channelUid });
    if (predictionAutoLockTimers.has(prediction.id)) {
      clearTimeout(predictionAutoLockTimers.get(prediction.id));
      predictionAutoLockTimers.delete(prediction.id);
    }
    broadcastPredictionSnapshot(prediction.channelUid, prediction, 'prediction:update');
    return res.json({ prediction });
  } catch (e) {
    console.error('[predictions:settle] error', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to settle prediction' });
  }
});

app.get('/api/public/:uid/prediction', async (req, res) => {
  const uid = String(req.params.uid || '').trim();
  if (!uid) return res.status(400).json({ error: 'uid required' });
  try {
    const prediction = await singleFlight(`public:prediction:${uid}`, () => (
      getActivePredictionForChannel(uid, { includeRecentlySettled: true, resultVisibleMs: 5000 })
    ));
    return res.json({ uid, prediction: toPublicPrediction(prediction) });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load prediction' });
  }
});

// --- Public pages & APIs (no auth) ---
// Helper: resolve sid by channel UID by scanning bot_settings
async function resolveSidByChannelUid(channelUid) {
  try {
    const all = await (await import('./supabase.js')).getBotSettings; // placeholder to ensure bundler keeps module
  } catch { }
  try {
    // Fetch all bot_settings and find a sid whose settings include given channelUid
    const { default: pkg } = await import('@supabase/supabase-js');
  } catch { }
  try {
    // Use existing supabase client through exported helper functions
    // We don't have direct access to the internal supabase client, so query via REST-like approach:
    // Workaround: list a small set of sids by checking ownerInfoCache and liveInfoCache (best-effort)
  } catch { }
  // Fallback: try heuristics via tokens table sample
  return null;
}

function normalizePublicCommandArray(value) {
  const source = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
  return source.map((item) => String(item || '').trim()).filter(Boolean);
}

function toPublicCommandRule(rule) {
  if (!rule || rule.enabled === false || rule.adminOnly === true || rule.adminonly === true) return null;
  const keywords = normalizePublicCommandArray(rule.keywords);
  if (!keywords.length) return null;
  return {
    id: rule.id,
    name: rule.name || keywords[0],
    keywords,
    responses: normalizePublicCommandArray(rule.responses),
    cooldown: Math.max(0, Number(rule.cooldown || 0)),
    requiredRoleLevel: Math.max(1, Number(rule.requiredRoleLevel || rule.required_role_level || 1)),
  };
}

function settingsIncludesPublicUid(settings, uid) {
  const target = String(uid || '').trim();
  if (!target) return false;
  const withoutPrefix = target.replace(/^(user:|cime:|chzzk:|youtube:)/, '');
  const candidates = new Set([target, withoutPrefix]);
  const source = settings || {};
  const configured = Array.isArray(source.channelUids)
    ? source.channelUids
    : (typeof source.channelUidsText === 'string' ? source.channelUidsText.split(',') : []);
  return configured.map((value) => String(value || '').trim()).some((value) => candidates.has(value));
}

async function resolvePublicChannelSid(uid) {
  const raw = String(uid || '').trim();
  if (!raw) return null;
  const withoutPrefix = raw.replace(/^(user:|cime:|chzzk:|youtube:)/, '');
  if (raw.startsWith('user:')) return raw;
  if (withoutPrefix) {
    const accounts = await listPlatformAccounts(withoutPrefix).catch(() => []);
    if (accounts?.length) return `user:${withoutPrefix}`;
  }

  const ownerUserId = await findAppUserIdByChannelUid(raw).catch(() => null);
  if (ownerUserId) return `user:${ownerUserId}`;

  const legacySids = Array.from(new Set([
    ...Array.from(activeSids.keys()),
    ...await listAllSidsWithTokens().catch(() => []),
  ].filter(Boolean)));
  for (const sid of legacySids) {
    const settings = await getBotSettings(sid).catch(() => ({}));
    if (settingsIncludesPublicUid(settings, raw)) return sid;
  }
  return null;
}

// Public API: list rules for streamer by channel UID
app.get('/api/public/:uid/rules', async (req, res) => {
  const uid = String(req.params.uid || '').trim();
  if (!uid) return res.status(400).json({ error: 'uid required' });
  try {
    const rules = await singleFlight(`public:rules:${uid}`, async () => {
      const sid = await resolvePublicChannelSid(uid);
      if (!sid) return [];
      const channelRules = await getBotRulesWithDefaults(sid);
      return (channelRules || []).map(toPublicCommandRule).filter(Boolean);
    });
    return res.json({ uid, rules });
  } catch (e) {
    console.error('[Public Rules] failed:', e?.message || e);
    return res.status(500).json({ error: 'Failed to load rules', rules: [] });
  }
});

// Public API: list points for streamer by channel UID
app.get('/api/public/:uid/points', async (req, res) => {
  const uid = String(req.params.uid || '').trim();
  if (!uid) return res.status(400).json({ error: 'uid required' });
  try {
    const requestedLimit = Number(req.query.limit || 0) || 0;
    const limit = requestedLimit > 0 ? Math.max(1, Math.min(500, requestedLimit)) : 0;
    const payload = await readRealtimeCached(`public:points:${uid}:${limit || 'all'}`, { ttlMs: 5000, staleMs: 30000 }, async () => {
      if (limit > 0) {
        const page = await listChannelPointsPage(uid, { offset: 0, limit });
        return {
          uid,
          points: page.rows || [],
          total: Number(page.total || 0),
          totalPoints: Number(page.totalPoints || 0),
          offset: 0,
          limit,
          updatedAt: new Date().toISOString(),
        };
      }
      const rows = await listChannelPoints(uid);
      return {
        uid,
        points: rows,
        total: rows.length,
        totalPoints: rows.reduce((sum, row) => sum + Number(row?.points || 0), 0),
        updatedAt: new Date().toISOString(),
      };
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load points' });
  }
});

// Send a chat message to the user's channel
app.post('/api/chzzk/chat/send', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });
    const { message } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > 100) {
      return res.status(400).json({ error: 'message must be <= 100 characters' });
    }

    // Start the event session in the background; chat send itself only needs the access token.
    let channelId;
    try {
      const accessToken = await getValidAccessToken(sid);
      const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const content = me?.data?.content || me?.data || {};
      channelId = content.channelId;
    } catch (e) {
      // If we cannot detect channel, we can still attempt ensureSession without it
    }

    if (channelId) {
      refreshChzzkLiveStatusForSid(sid, { channelUids: [String(channelId)] }).catch(() => { });
    }

    const accessToken = await getValidAccessToken(sid);
    const url = `${OPENAPI_BASE}/open/v1/chats/send`;
    const r = await axios.post(url, { message }, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    const content = r?.data?.content || r?.data || {};
    return res.json({ messageId: content.messageId || content.id || null });
  } catch (e) {
    console.error('Chat send error', e?.response?.data || e.message);
    return res.status(500).json({ error: 'Failed to send chat' });
  }
});

// GET /api/auth/chzzk/callback -> exchange code for tokens and store
app.get('/api/auth/chzzk/callback', async (req, res) => {
  try {
    console.log('[auth:callback] Callback received');
    const { code, state, error, error_description } = req.query;
    const savedState = req.cookies.oauth_state;
    const stateValidation = consumeOAuthState('chzzk', state, savedState);
    console.log('[auth:callback] Parameters:', { 
      code: code ? 'present' : 'missing',
      state: state ? 'present' : 'missing',
      savedState: savedState ? 'present' : 'missing',
      error: error ? String(error) : null,
      stateValidation
    });

    if (error) {
      if (stateValidation.ok || savedState) {
        clearManagedCookie(res, 'oauth_state');
      }
      const errorCode = String(error || '');
      const authStatus = errorCode === 'access_denied' ? 'cancelled' : 'error';
      console.warn('[CHZZK] OAuth authorization did not complete:', {
        error: errorCode,
        description: error_description ? String(error_description) : null,
        state: state ? 'present' : 'missing',
        savedState: savedState ? 'present' : 'missing',
        stateValidation
      });
      return res.redirect(getAuthRedirectUrlWithState(req, stateValidation, {
        auth: authStatus,
        platform: 'chzzk',
        reason: errorCode
      }));
    }

    if (!code || !state || !stateValidation.ok) {
      console.warn('[CHZZK] Invalid OAuth callback state/code:', {
        code: code ? 'present' : 'missing',
        state: state ? 'present' : 'missing',
        savedState: savedState ? 'present' : 'missing',
        stateValidation
      });
      if (savedState) clearManagedCookie(res, 'oauth_state');
      return res.redirect(getAuthRedirectUrlWithState(req, stateValidation, {
        auth: 'error',
        platform: 'chzzk',
        reason: !code ? 'missing_code' : 'invalid_state'
      }));
    }

    clearManagedCookie(res, 'oauth_state');
    const oldSid = getCookieSid(req);
    const preferredUserId = await getCurrentSessionUserId(req);

    const body = {
      grantType: 'authorization_code',
      clientId: CHZZK_CLIENT_ID,
      clientSecret: CHZZK_CLIENT_SECRET,
      code,
      state
    };

    const tokenResp = await axios.post(`${OPENAPI_BASE}/auth/v1/token`, body, {
      headers: { 'Content-Type': 'application/json' }
    });

    const tokenPayload = (tokenResp?.data && tokenResp.data.content) ? tokenResp.data.content : tokenResp?.data || {};
    const { accessToken, refreshToken, tokenType, expiresIn } = tokenPayload;

    if (!accessToken || !refreshToken) {
      console.error('Unexpected token response', tokenResp?.data);
      return res.status(500).send('Failed to obtain tokens');
    }

    // Resolve CHZZK userId using freshly obtained accessToken
    let pid = null;
    let loginChannelId = null;
    try {
      const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const content = me?.data?.content || me?.data || {};
      if (content?.channelId) {
        const platformUserId = String(content.channelId);
        loginChannelId = platformUserId;
        let accountUserId = preferredUserId || platformUserId;
        try {
          const profile = await platformProfiles.enrichChzzkProfile({
            platformUserId,
            channelId: platformUserId,
            channelName: content.channelName || null,
            channelHandle: content.channelHandle || null,
            channelImageUrl: content.channelImageUrl || null,
            metadata: { raw: content }
          });
          const identity = await upsertPlatformIdentity('chzzk', profile, preferredUserId || platformUserId);
          accountUserId = identity?.userId || accountUserId;
        } catch { }
        if (oldSid) { try { await migrateSidToUserPid(oldSid, accountUserId); } catch { } }
        pid = `user:${accountUserId}`;
        // Create session using existing cookie sid if present; else generate
        const existing = getCookieSid(req);
        const sidToken = existing && typeof existing === 'string' ? existing : ('rt_' + crypto.randomBytes(32).toString('hex'));
        console.log('[auth:callback] Creating session:', { 
          userId: accountUserId,
          platformUserId,
          existing: existing ? 'present' : 'missing',
          sidToken: sidToken ? 'generated' : 'missing'
        });
        try { 
          await upsertSession(sidToken, accountUserId, 30);
          console.log('[auth:callback] Session created successfully');
        } catch (e) { 
          console.error('[auth:callback] Failed to create session:', e.message);
        }
        try { 
          if (existing !== sidToken) {
            setCookieSid(res, sidToken);
            console.log('[auth:callback] Cookie set');
          } else {
            console.log('[auth:callback] Using existing cookie');
          }
        } catch (e) {
          console.error('[auth:callback] Failed to set cookie:', e.message);
        }
      }
    } catch { }
    if (!pid) {
      // Retry users/me a few times in case of transient delay
      for (let i = 0; i < 3 && !pid; i++) {
        try {
          await new Promise(r => setTimeout(r, 500));
          const me2 = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          const content2 = me2?.data?.content || me2?.data || {};
          const retryChannelId = content2?.channelId || content2?.userId;
          if (retryChannelId) {
            const platformUserId = String(retryChannelId);
            loginChannelId = platformUserId;
            const accountUserId = preferredUserId || platformUserId;
            if (oldSid) { try { await migrateSidToUserPid(oldSid, accountUserId); } catch { } }
            pid = `user:${accountUserId}`;
            const existing2 = getCookieSid(req);
            const sidToken2 = existing2 && typeof existing2 === 'string' ? existing2 : ('rt_' + crypto.randomBytes(32).toString('hex'));
            try { await upsertSession(sidToken2, accountUserId, 30); } catch { }
            try { if (existing2 !== sidToken2) setCookieSid(res, sidToken2); } catch { }
            break;
          }
        } catch { }
      }
    }

    // If still no pid, temporarily store under a temp session-based pid and log; will migrate later
    if (!pid) {
      const tempExisting = getCookieSid(req);
      const tempSidToken = tempExisting || ('rt_' + crypto.randomBytes(32).toString('hex'));
      if (!tempExisting) { try { setCookieSid(res, tempSidToken); } catch { } }
      pid = `sid:${tempSidToken}`;
      console.warn('[Auth] Could not resolve userId at callback time; storing tokens under', pid, 'and will migrate once userId is resolvable.');
    }

    await upsertTokens(pid, {
      accessToken,
      refreshToken,
      tokenType: tokenType || 'Bearer',
      expiresAt: computeExpiresAt(expiresIn || 86400)
    });
    if (pid && !pid.startsWith('sid:')) {
      refreshChzzkLiveStatusForSid(pid, {
        channelUids: loginChannelId ? [String(loginChannelId)] : undefined,
        force: true
      }).catch((err) => {
        console.warn('[CHZZK] Failed to refresh live status after OAuth callback:', err?.response?.data || err?.message || err);
      });
    }

    // Redirect back to app with success flag
    return res.redirect(getAuthRedirectUrlWithState(req, stateValidation, { auth: 'success', platform: 'chzzk', reason: null }));
  } catch (e) {
    console.error('Callback error', e?.response?.data || e.message);
    return res.redirect(getAuthRedirectUrl(req, { auth: 'error', platform: 'chzzk' }));
  }
});

// GET /api/auth/chzzk/token -> return current valid access token (auto-refresh if needed)
app.get('/api/auth/chzzk/token', async (req, res) => {
  try {
    let sid = await getPartitionId(req, res);
    let tokens = sid ? await getTokens(sid) : null;
    if (!tokens) {
      // Fallback: try temporary storage under sid:<cookieSid>
      const sidToken = getCookieSid(req);
      if (sidToken) {
        const tempPid = `sid:${sidToken}`;
        tokens = await getTokens(tempPid);
        if (tokens) {
          try {
            const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
              headers: { Authorization: `Bearer ${tokens.tokenType || 'Bearer'} ${tokens.accessToken}` }
            });
            const content = me?.data?.content || me?.data || {};
            if (content?.channelId) {
              const userId = String(content.channelId);
              try { await migrateSidToUserPid(sidToken, userId); } catch { }
              sid = `user:${userId}`;
              // Reuse existing cookie sid; do NOT rotate
              try { await upsertSession(sidToken, userId, 30); } catch { }
              // Ensure tokens are saved under user pid as well
              try {
                await upsertTokens(sid, {
                  accessToken: tokens.accessToken,
                  refreshToken: tokens.refreshToken,
                  tokenType: tokens.tokenType || 'Bearer',
                  expiresAt: tokens.expiresAt,
                });
              } catch { }
            }
          } catch { }
        }
      }
    }
    if (!tokens) return res.status(404).json({ error: 'No tokens stored' });

    const now = new Date();
    const expiresAt = new Date(tokens.expiresAt);
    if (isNaN(expiresAt.getTime()) || expiresAt <= now) {
      // refresh
      const body = {
        grantType: 'refresh_token',
        refreshToken: tokens.refreshToken,
        clientId: CHZZK_CLIENT_ID,
        clientSecret: CHZZK_CLIENT_SECRET
      };
      const r = await axios.post(`${OPENAPI_BASE}/auth/v1/token`, body, {
        headers: { 'Content-Type': 'application/json' }
      });
      const rPayload = (r?.data && r.data.content) ? r.data.content : r?.data || {};
      const { accessToken, refreshToken, tokenType, expiresIn } = rPayload;
      tokens = {
        accessToken,
        refreshToken: refreshToken || tokens.refreshToken,
        tokenType: tokenType || 'Bearer',
        expiresAt: computeExpiresAt(expiresIn || 86400)
      };
      await updateTokens(sid, tokens);
    }

    // Ensure we have a session mapped for current cookie sid token
    try {
      const cookieSid = getCookieSid(req);
      if (cookieSid) {
        const mapped = await getSessionUserId(cookieSid);
        if (!mapped) {
          const meChk = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
            headers: { Authorization: `Bearer ${tokens.tokenType || 'Bearer'} ${tokens.accessToken}` }
          });
          const content = meChk?.data?.content || meChk?.data || {};
          if (content?.channelId) {
            await upsertSession(cookieSid, String(content.channelId), 30);
          }
        }
      }
    } catch { }

    return res.json({ accessToken: tokens.accessToken, tokenType: tokens.tokenType, expiresAt: tokens.expiresAt });
  } catch (e) {
    console.error('Token fetch/refresh error', e?.response?.data || e.message);
    return res.status(500).json({ error: 'Failed to fetch/refresh token' });
  }
});

// POST /api/auth/chzzk/revoke -> revoke tokens
app.post('/api/auth/chzzk/revoke', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    const requestedPlatformUserId = String(req.body?.platformUserId || req.body?.platform_user_id || '').trim();
    const sid = ownerUserId ? `user:${ownerUserId}` : await getPartitionId(req, res);
    const tokens = sid ? await getTokens(sid) : null;
    if (tokens && !requestedPlatformUserId) {
      for (const [token, tokenTypeHint] of [[tokens.accessToken, 'access_token'], [tokens.refreshToken, 'refresh_token']]) {
        if (!token) continue;
        try {
          await revokeTokens({
            clientId: CHZZK_CLIENT_ID,
            clientSecret: CHZZK_CLIENT_SECRET,
            token,
            tokenTypeHint,
            baseUrl: OPENAPI_BASE
          });
        } catch { }
      }
      await updateTokens(sid, null);
    }

    if (ownerUserId) {
      const accounts = await listPlatformAccounts(ownerUserId).catch(() => []);
      const chzzkAccount = requestedPlatformUserId
        ? accounts.find((account) => String(account.provider || '').toLowerCase() === 'chzzk' && String(account.platform_user_id || '') === requestedPlatformUserId)
        : accounts.find((account) => String(account.provider || '').toLowerCase() === 'chzzk');
      try { await deletePlatformAccount('chzzk', ownerUserId, requestedPlatformUserId || chzzkAccount?.platform_user_id || null); } catch { }
      const platforms = await listPlatformAccounts(ownerUserId).catch(() => []);
      return res.json({ ok: true, platforms });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('Revoke error', e?.response?.data || e.message);
    return res.status(500).json({ error: 'Failed to revoke' });
  }
});

app.get('/api/channel/cache-stats', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const stats = getSessionCacheStats();
    const accessStats = getChannelAccessStats();

    return res.json({
      cacheStats: stats,
      accessStats: accessStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[ChannelContext] Failed to get cache stats:', error);
    return res.status(500).json({
      error: 'Failed to retrieve cache statistics',
      code: 'STATS_ERROR'
    });
  }
});

app.get('/api/channel/performance', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(404).json({ error: 'Channel context not found' });
    }

    // SQLite ?깅뒫 ?듦퀎
    const { getChannelPerformanceStats } = await import('./sqlite.js');
    const sqliteStats = getChannelPerformanceStats(channelContext.channelId);

    let supabaseStats = null;
    if (hasDirectDatabaseUrl()) {
      try {
        const { getChannelPerformanceStatsSupabase } = await import('./supabase.js');
        supabaseStats = await getChannelPerformanceStatsSupabase(channelContext.channelId);
      } catch (error) {
        console.warn('[API] Supabase performance stats failed:', error);
      }
    }

    const wsStats = getChannelConnectionStats(channelContext.channelId);

    res.json({
      success: true,
      channelId: channelContext.channelId,
      performance: {
        sqlite: sqliteStats[0] || null,
        supabase: supabaseStats?.[0] || null,
        websocket: wsStats
      }
    });

  } catch (error) {
    console.error('[API] Channel performance error:', error);
    res.status(500).json({
      error: 'Failed to get performance stats',
      details: error.message
    });
  }
});

app.get('/api/admin/database/performance', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    //
    const { analyzeDatabasePerformance } = await import('./sqlite.js');
    const sqliteAnalysis = analyzeDatabasePerformance();

    let supabaseAnalysis = null;
    if (hasDirectDatabaseUrl()) {
      try {
        const {
          analyzeQueryPerformanceSupabase,
          monitorIndexUsageSupabase,
          getPerformanceRecommendationsSupabase
        } = await import('./supabase.js');

        const [queryPerf, indexUsage, recommendations] = await Promise.all([
          analyzeQueryPerformanceSupabase(),
          monitorIndexUsageSupabase(),
          getPerformanceRecommendationsSupabase()
        ]);

        supabaseAnalysis = {
          queryPerformance: queryPerf,
          indexUsage,
          recommendations
        };
      } catch (error) {
        console.warn('[API] Supabase analysis failed:', error);
      }
    }

    res.json({
      success: true,
      analysis: {
        sqlite: sqliteAnalysis,
        supabase: supabaseAnalysis
      }
    });

  } catch (error) {
    console.error('[API] Database performance analysis error:', error);
    res.status(500).json({
      error: 'Failed to analyze database performance',
      details: error.message
    });
  }
});

app.post('/api/admin/database/optimize', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { optimizeDatabase } = await import('./sqlite.js');
    const sqliteResult = optimizeDatabase();

    let supabaseResult = null;
    if (hasDirectDatabaseUrl()) {
      try {
        const { updateChannelStatisticsSupabase } = await import('./supabase.js');
        const success = await updateChannelStatisticsSupabase();
        supabaseResult = { success };
      } catch (error) {
        console.warn('[API] Supabase optimization failed:', error);
        supabaseResult = { success: false, error: error.message };
      }
    }

    res.json({
      success: true,
      optimization: {
        sqlite: sqliteResult,
        supabase: supabaseResult
      }
    });

  } catch (error) {
    console.error('[API] Database optimization error:', error);
    res.status(500).json({
      error: 'Failed to optimize database',
      details: error.message
    });
  }
});

app.get('/api/admin/security/channel-access', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stats = getChannelAccessStats();

    res.json({
      success: true,
      statistics: stats,
      summary: {
        totalRequests: stats.totalRequests,
        deniedRequests: stats.deniedRequests,
        denialRate: stats.totalRequests > 0 ? (stats.deniedRequests / stats.totalRequests * 100).toFixed(2) + '%' : '0%',
        crossChannelAttempts: stats.crossChannelAttempts,
        suspiciousPatterns: stats.suspiciousPatterns,
        activeUserTracking: stats.userAttemptCounts ? Object.keys(stats.userAttemptCounts).length : 0,
        activeIpTracking: stats.ipAttemptCounts ? Object.keys(stats.ipAttemptCounts).length : 0
      }
    });

  } catch (error) {
    console.error('[API] Channel access stats error:', error);
    res.status(500).json({
      error: 'Failed to get channel access statistics',
      details: error.message
    });
  }
});

app.post('/api/admin/security/channel-access/reset', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    //
    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(403).json({ error: 'Access denied' });
    }

    resetChannelAccessStats();

    res.json({
      success: true,
      message: 'Channel access statistics have been reset',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API] Channel access stats reset error:', error);
    res.status(500).json({
      error: 'Failed to reset channel access statistics',
      details: error.message
    });
  }
});

app.get('/api/admin/security/events', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    //
    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const filters = {
      type: req.query.type,
      severity: req.query.severity,
      userId: req.query.userId,
      channelId: req.query.channelId,
      since: req.query.since,
      limit: req.query.limit || 100
    };

    const events = getSecurityEvents(filters);
    const statistics = getSecurityStatistics();

    res.json({
      success: true,
      events,
      statistics,
      filters: Object.fromEntries(
        Object.entries(filters).filter(([_, value]) => value !== undefined)
      )
    });

  } catch (error) {
    console.error('[API] Security events error:', error);
    res.status(500).json({
      error: 'Failed to get security events',
      details: error.message
    });
  }
});

app.get('/api/admin/security/statistics', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    //
    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const statistics = getSecurityStatistics();

    res.json({
      success: true,
      statistics,
      eventTypes: Object.values(SECURITY_EVENT_TYPES),
      severityLevels: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
    });

  } catch (error) {
    console.error('[API] Security statistics error:', error);
    res.status(500).json({
      error: 'Failed to get security statistics',
      details: error.message
    });
  }
});

app.get('/api/admin/security/suspicious-tokens', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    //
    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const suspiciousTokens = Array.from(securityEventLog.suspiciousTokens).map(token => {
      const usage = securityEventLog.tokenUsageTracking.get(token);
      return {
        token: token.substring(0, 8) + '...',
        tokenType: usage?.tokenType || 'unknown',
        usageCount: usage?.usageCount || 0,
        channelCount: usage?.channels?.size || 0,
        ipCount: usage?.ips?.size || 0,
        userAgentCount: usage?.userAgents?.size || 0,
        firstUsed: usage?.firstUsed ? new Date(usage.firstUsed).toISOString() : null,
        lastUsed: usage?.lastUsed ? new Date(usage.lastUsed).toISOString() : null
      };
    });

    res.json({
      success: true,
      suspiciousTokens,
      totalCount: suspiciousTokens.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API] Suspicious tokens error:', error);
    res.status(500).json({
      error: 'Failed to get suspicious tokens',
      details: error.message
    });
  }
});

app.get('/api/channel/tokens/stats', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(404).json({ error: 'Channel context not found' });
    }

    const memoryStats = getTokenManagementStatus(channelContext.channelId);
    const usageStats = getTokenUsageStats(null, channelContext.channelId);

    let sqliteStats = null;
    try {
      const { getChannelTokenStats } = await import('./sqlite.js');
      sqliteStats = getChannelTokenStats(channelContext.channelId);
    } catch (error) {
      console.warn('[API] SQLite token stats failed:', error);
    }

    let supabaseStats = null;
    if (hasDirectDatabaseUrl()) {
      try {
        const { getChannelTokenStatsSupabase } = await import('./supabase.js');
        supabaseStats = await getChannelTokenStatsSupabase(channelContext.channelId);
      } catch (error) {
        console.warn('[API] Supabase token stats failed:', error);
      }
    }

    res.json({
      success: true,
      channelId: channelContext.channelId,
      timestamp: Date.now(),
      tokenStats: {
        memory: {
          management: memoryStats,
          usage: usageStats
        },
        sqlite: sqliteStats,
        supabase: supabaseStats
      }
    });

  } catch (error) {
    console.error('[API] Channel token stats error:', error);
    res.status(500).json({
      error: 'Failed to get token stats',
      details: error.message
    });
  }
});

app.get('/api/channel/tokens/usage', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(404).json({ error: 'Channel context not found' });
    }

    const { token } = req.query;

    let usageStats;
    if (token) {
      usageStats = getTokenUsageStats(token);
      if (!usageStats) {
        return res.status(404).json({ error: 'Token not found' });
      }
    } else {
      usageStats = getTokenUsageStats(null, channelContext.channelId);
    }

    res.json({
      success: true,
      channelId: channelContext.channelId,
      timestamp: Date.now(),
      usageStats
    });

  } catch (error) {
    console.error('[API] Token usage stats error:', error);
    res.status(500).json({
      error: 'Failed to get token usage stats',
      details: error.message
    });
  }
});

app.post('/api/channel/tokens/cleanup', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(404).json({ error: 'Channel context not found' });
    }

    const { maxAgeHours = 24 } = req.body;
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

    const revokedCount = await revokeExpiredChannelTokens(channelContext.channelId, maxAgeMs);

    const statsCleanedCount = cleanupTokenStats(maxAgeMs);

    res.json({
      success: true,
      channelId: channelContext.channelId,
      timestamp: Date.now(),
      cleanup: {
        revokedTokens: revokedCount,
        cleanedStats: statsCleanedCount,
        maxAgeHours
      }
    });

  } catch (error) {
    console.error('[API] Token cleanup error:', error);
    res.status(500).json({
      error: 'Failed to cleanup tokens',
      details: error.message
    });
  }
});

app.post('/api/channel/tokens/validate', requireOpsAuth, async (req, res) => {
  try {
    const { token, expectedChannelId } = req.body;

    if (!token) {
      return res.status(400).json({
        error: 'Token required',
        code: 'TOKEN_REQUIRED'
      });
    }

    const validation = await validateChannelToken(token, expectedChannelId, true);

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
        code: 'TOKEN_INVALID'
      });
    }

    res.json({
      success: true,
      valid: true,
      channelId: validation.channelId,
      usageCount: validation.usageCount,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('[API] Token validation error:', error);
    res.status(500).json({
      error: 'Failed to validate token',
      details: error.message
    });
  }
});

app.get('/api/channel/tokens/management', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(404).json({ error: 'Channel context not found' });
    }

    const managementStatus = getTokenManagementStatus(channelContext.channelId);

    res.json({
      success: true,
      channelId: channelContext.channelId,
      managementStatus
    });

  } catch (error) {
    console.error('[API] Token management status error:', error);
    res.status(500).json({
      error: 'Failed to get token management status',
      details: error.message
    });
  }
});

app.post('/api/channel/tokens/generate', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(404).json({ error: 'Channel context not found' });
    }

    const { tokenType } = req.body;

    if (!tokenType || !['roulette', 'pvd'].includes(tokenType)) {
      return res.status(400).json({
        error: 'Invalid token type. Must be "roulette" or "pvd"',
        code: 'INVALID_TOKEN_TYPE'
      });
    }

    const token = await generateChannelToken(channelContext.channelId, tokenType);

    res.json({
      success: true,
      channelId: channelContext.channelId,
      tokenType,
      token,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('[API] Token generation error:', error);
    res.status(500).json({
      error: 'Failed to generate token',
      details: error.message
    });
  }
});

app.post('/api/channel/validate', async (req, res) => {
  try {
    const { channelId, token } = req.body;

    if (!channelId) {
      return res.status(400).json({
        error: 'Channel ID required',
        code: 'CHANNEL_ID_REQUIRED'
      });
    }

    if (!validateChannelId(channelId)) {
      return res.status(400).json({
        error: 'Invalid channel ID format',
        code: 'INVALID_CHANNEL_ID'
      });
    }

    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(404).json({
        error: 'Channel context not found',
        code: 'CONTEXT_NOT_FOUND'
      });
    }

    const isValid = channelContext.channelId === channelId;
    const response = {
      valid: isValid,
      channelId: channelContext.channelId,
      requestedChannelId: channelId,
      channelValidated: isValid,
      timestamp: Date.now()
    };

    if (token) {
      const tokenValidation = await validateChannelToken(token, channelId, false);
      response.tokenValidation = {
        valid: tokenValidation.valid,
        error: tokenValidation.error,
        tokenChannelId: tokenValidation.channelId
      };
    }

    res.json(response);

  } catch (error) {
    console.error('[API] Channel validation error:', error);
    res.status(500).json({
      error: 'Failed to validate channel',
      details: error.message
    });
  }
});

app.get('/api/channel/tokens/report', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(404).json({ error: 'Channel context not found' });
    }

    const report = generateTokenManagementReport();

    const channelReport = {
      timestamp: report.timestamp,
      channelId: channelContext.channelId,
      summary: report.summary,
      channelDetails: report.channels[channelContext.channelId] || {
        tokenCount: 0,
        totalUsage: 0,
        recentTokens: 0,
        recentUsage: 0
      },
      systemHealth: report.systemHealth,
      recentActivity: report.recentActivity
    };

    res.json({
      success: true,
      report: channelReport
    });

  } catch (error) {
    console.error('[API] Token report error:', error);
    res.status(500).json({
      error: 'Failed to generate token report',
      details: error.message
    });
  }
});

app.get('/api/channel/tokens/health', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const health = checkTokenSystemHealth();

    res.json({
      success: true,
      health
    });

  } catch (error) {
    console.error('[API] Token health check error:', error);
    res.status(500).json({
      error: 'Failed to check token system health',
      details: error.message
    });
  }
});

app.post('/api/channel/tokens/maintenance', requireOpsAuth, async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      return res.status(404).json({ error: 'Channel context not found' });
    }

    const maintenanceResult = await runTokenMaintenanceScheduler();

    res.json({
      success: true,
      channelId: channelContext.channelId,
      timestamp: Date.now(),
      maintenance: maintenanceResult
    });

  } catch (error) {
    console.error('[API] Token maintenance error:', error);
    res.status(500).json({
      error: 'Failed to run token maintenance',
      details: error.message
    });
  }
});

// Manual bootstrap: attach current cookie sid only to tokens already stored for that same temporary sid.
app.post('/api/auth/chzzk/session/attach', async (req, res) => {
  try {
    const cookieSid = getCookieSid(req);
    if (!cookieSid) return res.status(400).json({ error: 'No cookie sid' });
    // If already mapped, succeed
    const mapped = await getSessionUserId(cookieSid);
    if (mapped) return res.json({ ok: true, userId: mapped, note: 'already_mapped' });

    const originSid = `sid:${cookieSid}`;
    const tempTokens = await getTokens(originSid);
    if (!tempTokens) return res.status(404).json({ error: 'No temporary tokens for current session' });
    let tokenType = tempTokens.tokenType || 'Bearer';
    let accessToken = tempTokens.accessToken;
    let refreshToken = tempTokens.refreshToken;

    const callUsersMe = async () => {
      const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
        headers: { Authorization: `${tokenType} ${accessToken}` }
      });
      return me?.data?.content || me?.data || {};
    };

    try {
      const content = await callUsersMe();
      if (!content?.channelId) return res.status(502).json({ error: 'users/me returned no userId' });
      const uid = String(content.channelId);
      await upsertSession(cookieSid, uid, 30);
      return res.json({ ok: true, userId: uid, note: 'attached' });
    } catch (e) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      console.warn('[SessionAttach] initial users/me failed', status, data || e.message);
      // Try to refresh if we have a refresh token
      if (refreshToken) {
        try {
          const body = {
            grantType: 'refresh_token',
            refreshToken,
            clientId: CHZZK_CLIENT_ID,
            clientSecret: CHZZK_CLIENT_SECRET,
          };
          const r = await axios.post(`${OPENAPI_BASE}/auth/v1/token`, body, {
            headers: { 'Content-Type': 'application/json' }
          });
          const rPayload = (r?.data && r.data.content) ? r.data.content : r?.data || {};
          accessToken = rPayload.accessToken || accessToken;
          refreshToken = rPayload.refreshToken || refreshToken;
          tokenType = rPayload.tokenType || tokenType;
          // Persist refreshed tokens back to their original sid so rest of system stays consistent
          try {
            await updateTokens(originSid, {
              accessToken,
              refreshToken,
              tokenType,
              expiresAt: computeExpiresAt(rPayload.expiresIn || 86400),
            });
          } catch { }
          // Retry users/me
          try {
            const content2 = await callUsersMe();
            if (!content2?.userId) return res.status(502).json({ error: 'users/me returned no userId after refresh' });
            const uid = String(content2.userId);
            await upsertSession(cookieSid, uid, 30);
            return res.json({ ok: true, userId: uid, note: 'attached_after_refresh' });
          } catch (e2) {
            console.error('[SessionAttach] users/me after refresh failed', e2?.response?.data || e2.message);
            return res.status(502).json({ error: 'Failed to resolve userId via users/me after refresh' });
          }
        } catch (re) {
          console.error('[SessionAttach] token refresh failed', re?.response?.data || re.message);
          return res.status(502).json({ error: 'Failed to refresh token' });
        }
      }
      return res.status(502).json({ error: 'Failed to resolve userId via users/me' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Failed to attach session' });
  }
});

// Helper to get a valid access token (refreshing if necessary)
async function getValidAccessToken(sid) {
  // Reuse logic in /api/auth/chzzk/token by calling the function flow inline
  let tokens = await getTokens(sid);
  if (!tokens) throw new Error('No tokens stored');
  const now = new Date();
  const expiresAt = new Date(tokens.expiresAt);
  if (isNaN(expiresAt.getTime()) || expiresAt <= now) {
    const body = {
      grantType: 'refresh_token',
      refreshToken: tokens.refreshToken,
      clientId: CHZZK_CLIENT_ID,
      clientSecret: CHZZK_CLIENT_SECRET
    };
    const r = await axios.post(`${OPENAPI_BASE}/auth/v1/token`, body, {
      headers: { 'Content-Type': 'application/json' }
    });
    const rPayload = (r?.data && r.data.content) ? r.data.content : r?.data || {};
    const { accessToken, refreshToken, tokenType, expiresIn } = rPayload;
    tokens = {
      accessToken,
      refreshToken: refreshToken || tokens.refreshToken,
      tokenType: tokenType || 'Bearer',
      expiresAt: computeExpiresAt(expiresIn || 86400)
    };
    await updateTokens(sid, tokens);
  }
  return tokens.accessToken;
}

function buildUrl(pathTemplate, params = {}) {
  let url = `${API_BASE}${pathTemplate.startsWith('/') ? '' : '/'}${pathTemplate}`;
  Object.entries(params).forEach(([k, v]) => {
    url = url.replace(new RegExp(`{${k}}`, 'g'), encodeURIComponent(String(v)));
  });
  return url;
}

async function fetchList(url, accessToken, query = {}) {
  const full = new URL(url);
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') full.searchParams.set(k, String(v));
  });
  const resp = await axios.get(full.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = resp?.data;
  // Try common wrappers
  const content = data?.content ?? data;
  const list = content?.items ?? content?.list ?? content?.data ?? (Array.isArray(content) ? content : []);
  return Array.isArray(list) ? list : [];
}

function normalizeEvents(type, items) {
  return items.map((it) => {
    const id = it.id || it.messageId || it.msgId || it.eventId || `${Date.now()}_${Math.random()}`;
    const ts = it.timestamp || it.createdAt || it.msgTime || Date.now();
    const user = it.user?.nickname || it.profile?.nickname || it.nickname || 'Unknown';
    const message = it.message || it.msg || it.text || it.content || '';
    const amount = it.amount || it.point || it.price || undefined;
    const months = it.months || it.tier || undefined;
    return { type, id, ts, user, message, amount, months, raw: it };
  });
}

// Polling endpoint to aggregate events
// GET /api/chzzk/events?channelId=xxx&since=timestamp
// --- Session-based subscription manager ---
// Keyed by sid (per user). Each entry can subscribe to one or more channels, but our current flow subscribes to the user's own channel.
// sessionStore is declared near app initialization because early timers reference it during top-level awaits.
// Deduplicate: share one socket per channelId across multiple sids
const channelSessionStore = new Map(); // channelId -> entry
// Global per-channel dedup for processed chat ids and sent replies to avoid duplicates on reconnects
const globalProcessedChat = new Map(); // channelId -> Set(keys)
const globalSentReplies = new Map();   // channelId -> Set(keys)
const MAX_QUEUE = 1000;
const sessionCreatePromises = new Map(); // sid -> Promise(entry)

async function ensureSession(sid, channelId) {
  if (!channelId) {
    try {
      channelId = await resolveChannelIdForOwnerUserId(ownerUserIdFromSid(sid), { provider: 'chzzk', allowFallback: false });
    } catch { }
  }
  let entry = sessionStore.get(sid);
  // If we already have a per-channel session, reuse it and map this sid to it
  const chKey = String(channelId || '');
  if (!entry && chKey && channelSessionStore.has(chKey)) {
    entry = channelSessionStore.get(chKey);
    sessionStore.set(sid, entry);
  }
  if (entry && entry.connected) {
    // Ensure subscription for requested channel
    await ensureSubscribed(entry, sid, channelId);
    // Track sid under this shared entry
    try { entry.sids && entry.sids.add(sid); } catch { }
    return entry;
  }

  // Debounce concurrent creations
  if (sessionCreatePromises.has(sid)) {
    const pending = await sessionCreatePromises.get(sid);
    await ensureSubscribed(pending, sid, channelId);
    return pending;
  }

  const accessToken = await getValidAccessToken(sid);
  // Create session (user)
  const sessResp = await axios.get(`${OPENAPI_BASE}/open/v1/sessions/auth`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const url = (sessResp?.data && sessResp.data.content && sessResp.data.content.url) ? sessResp.data.content.url : sessResp?.data?.url;
  if (!url) throw new Error('Failed to create session URL');

  const socketOption = {
    reconnection: false,
    forceNew: true,
    timeout: 3000,
    transports: ['websocket'],
  };

  // If there is an existing socket, disconnect it to avoid session limits
  if (entry && entry.socket) {
    try {
      if (entry.socket.connected || typeof entry.socket.disconnect === 'function') {
        entry.socket.disconnect();
      }
    } catch { }
  }

  const createPromise = (async () => {
    const io = await getIoClient();
    const socket = typeof io === 'function' ? io(url, socketOption) : io.connect(url, socketOption);
    entry = { socket, sessionKey: null, queue: [], connected: false, subscribed: new Set(), channelId: chKey || null, sids: new Set([sid]), primarySid: sid };
    sessionStore.set(sid, entry);
    if (chKey) channelSessionStore.set(chKey, entry);

    socket.on('connect', () => {
      // Wait for SYSTEM connected message to get sessionKey
    });

    socket.on('SYSTEM', async (raw) => {
      try {
        const data = (typeof raw === 'string') ? JSON.parse(raw) : raw;
        const type = data?.type;
        console.log('[CHZZK SYSTEM]', type, data);
        if (type === 'connected') {
          entry.sessionKey = data?.data?.sessionKey || entry.sessionKey;
          entry.connected = true;
          // Subscribe events for this channel
          await ensureSubscribed(entry, sid, channelId);
        } else if (type === 'revoked' || type === 'unsubscribed') {
          // Optionally handle
        } else if (type === 'subscribed') {
          // Ok
        }
      } catch (e) {
        console.error('SYSTEM handler error', e?.response?.data || e.message);
      }
    });

    // Cleanup on disconnect: remove per-channel mapping if this was the shared entry
    socket.on('disconnect', () => {
      try {
        const key = entry && entry.channelId ? String(entry.channelId) : null;
        if (key && channelSessionStore.get(key) === entry) {
          channelSessionStore.delete(key);
        }
        // Do not purge sessionStore mapping; next ensureSession will recreate or remap
      } catch { }
    });

    socket.on('CHAT', (raw) => {
      const msg = (typeof raw === 'string') ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : raw;
      // Per-channel dedup: avoid processing the same chat more than once
      try {
        const uid = String(msg?.profile?.userId || msg?.senderChannelId || '');
        const text = String(msg?.content || '');
        const t = Number(msg?.messageTime || msg?.timestamp || msg?.msgTime || 0);
        const mid = String(msg?.messageId || msg?.id || msg?.msgId || msg?.eventId || '');
        const key = mid || `${uid}|${t}|${text.slice(0, 64)}`;
        if (!entry.processedChatIds) entry.processedChatIds = new Map(); // key -> ts
        if (key) {
          if (entry.processedChatIds.has(key)) {
            return; // already processed
          }
          entry.processedChatIds.set(key, Date.now());
          // Prune to last 200 items to bound memory
          if (entry.processedChatIds.size > 200) {
            const it = entry.processedChatIds.keys();
            const first = it.next();
            if (!first.done) entry.processedChatIds.delete(first.value);
          }
        }
        // Global per-channel guard (survives entry recreation)
        const ch = String(entry?.channelId || '');
        if (ch && key) {
          let set = globalProcessedChat.get(ch);
          if (!set) { set = new Set(); globalProcessedChat.set(ch, set); }
          if (set.has(key)) return;
          set.add(key);
          // prune roughly by size
          if (set.size > 5000) {
            // delete 100 oldest by iterating
            let i = 0; for (const k of set) { set.delete(k); if (++i >= 100) break; }
          }
        }
      } catch { }

      const ev = {
        type: 'chat',
        id: msg?.messageTime || Date.now(),
        ts: msg?.messageTime || Date.now(),
        user: msg?.profile?.nickname || 'Unknown',
        id: msg?.senderChannelId || '',
        message: msg?.content || '',
        raw: msg,
      };
      pushEvent(entry, ev);

      // Server-side rule processing: if message starts with any enabled keyword, reply
      (async () => {
        try {
          const text = String(ev.message || '').trim();
          if (!text) return;
          const sid = entry?.primarySid || ([...sessionStore.entries()].find(([, e]) => e === entry)?.[0]);
          if (!sid) return;

          const liveState = await refreshChzzkLiveStatusForSid(sid, { ttlMs: 5000 });
          if (!liveState.live) return;

          // Identify user and username once (prefer numeric/string userId from profile)
          const resolvedUsername = String(msg?.profile?.nickname || ev.user || 'Unknown');
          const resolvedUserId = String(
            (msg?.senderChannelId ?? msg?.profile?.userId ?? '') || resolvedUsername || 'unknown_user'
          );

          // Determine if author is the channel owner; do not abort handler (owner should be able to trigger commands)
          let isOwner = false;
          try {
            const owner = await getOwnerInfoForSid(sid);
            if (owner?.userId && String(msg?.profile?.userId || '') === String(owner.userId)) {
              isOwner = true;
            }
          } catch { }

          // Additional guard: mark recognizable bot account to avoid attendance/echo loops (do not abort rule flow here)
          let isBotSelf = false;
          try {
            const isKnownBotName = typeof resolvedUserId === 'string' && resolvedUserId.toLowerCase() === '3e2835746563bde264f686303edc2a48';
            if (isKnownBotName) {
              isBotSelf = true;
            }
          } catch { }
          try {
            if (!isBotSelf) isBotSelf = await isLikelyChzzkBotSelfEcho(entry, sid, msg, ev, resolvedUserId);
          } catch { }
          if (isBotSelf) return;

          // Attendance: only when actually live. If not live, always skip attendance.
          const currentlyLive = !!liveState.live;
          if (currentlyLive) {
            const attendanceStartTime = Date.now();
            const attendDate = await getAttendanceDate(sid);
            const attKey = `${sid}:${resolvedUserId}:${attendDate}`;

            let dateSource = 'unknown';
            const cachedSession = liveSession.get(sid);
            if (cachedSession?.live && cachedSession?.startDate === attendDate) {
              dateSource = 'memory';
            } else {
              try {
                const dbSession = await getLiveSessionFromDB(sid);
                if (dbSession?.live && dbSession?.start_date === attendDate) {
                  dateSource = 'database';
                } else {
                  dateSource = attendDate === getKstDateString() ? 'current_kst' : 'emergency';
                }
              } catch {
                dateSource = attendDate === getKstDateString() ? 'current_kst' : 'emergency';
              }
            }

            try {
              if (!attendanceDedupe.has(attKey)) {
                // Skip attendance for bot owner and excluded user IDs
                const settings = await getBotSettings(sid) || {};
                const owner = await getOwnerInfoForSid(sid);
                const excludedFromText = typeof settings.attendanceExcludeUserIdsText === 'string'
                  ? settings.attendanceExcludeUserIdsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
                  : [];
                const excluded = Array.isArray(settings.attendanceExcludeUserIds) ? settings.attendanceExcludeUserIds.map(String) : [];
                const excludedSet = new Set([...(excluded || []), ...(excludedFromText || [])].map(String));
                const isOwner = owner?.userId && String(resolvedUserId) === String(owner.userId);

                if (!isOwner && !isBotSelf && !excludedSet.has(String(resolvedUserId))) {
                  const recordStartTime = Date.now();
                  const result = await recordAttendanceAndGetStreak(sid, resolvedUserId, resolvedUsername, attendDate);
                  attendanceDedupe.add(attKey);

                  //
                  let totalDays = 0;
                  try {
                    totalDays = await getUserAttendanceTotalDays(sid, resolvedUserId);
                  } catch (error) {
                    console.warn(`[Attendance] Failed to get total days for ${resolvedUserId}:`, error);
                  }

                  logAttendanceAttempt(sid, resolvedUserId, resolvedUsername, attendDate, {
                    ...result,
                    totalDays
                  }, dateSource, {
                    processingTime: Date.now() - attendanceStartTime,
                    recordTime: Date.now() - recordStartTime,
                    dedupeKey: attKey
                  });
                  if (result && result.isNew) {
                    const shouldAnnounce = settings.attendanceAnnounce !== false; // default true
                    const attendanceBonus = Math.max(0, Number(settings.channelPointsPerAttendance || 0));
                    if (shouldAnnounce) {
                      const accessToken = await getValidAccessToken(sid);
                      if (entry.sessionKey && accessToken) {
                        const url = `${OPENAPI_BASE}/open/v1/chats/send`;
                        let totalDays = 0;
                        try { totalDays = await getUserAttendanceTotalDays(sid, resolvedUserId); } catch { }
                        const text = renderAttendanceMessage(settings.attendanceMessage, {
                          username: resolvedUsername,
                          userId: resolvedUserId,
                          streak: result.streak,
                          totalDays,
                          points: attendanceBonus,
                          date: attendDate
                        });
                        await axios.post(url, { message: text }, {
                          params: { sessionKey: entry.sessionKey },
                          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
                        }).catch(() => { });
                        rememberOutboundMessage(entry, text);
                      }
                    }
                    // Attendance bonus channel points
                    try {
                      const bonus = attendanceBonus;
                      if (bonus > 0) {
                        // Resolve streamer channel UID
                        let channelUid = null;
                        const uids = await resolveChzzkChannelUidsForSid(sid, settings);
                        if (uids.length) channelUid = uids[0];
                        if (channelUid && !(await isChannelPointExcluded(settings, resolvedUserId))) {
                          try { await incrChannelPoints(channelUid, resolvedUserId, resolvedUsername, bonus); } catch { }
                        }
                      }
                    } catch { }
                  }
                }
              }
            } catch (e) {
              // attendance errors should not break chat processing
            }
          }

          // Channel Points: when live, give N per chat to the user (skip owner/bot self)
          try {
            if (currentlyLive) {
              // Resolve streamer channel UID
              let channelUid = null;
              const settings = await getBotSettings(sid) || {};
              const uids = await resolveChzzkChannelUidsForSid(sid, settings);
              if (uids.length) channelUid = uids[0];
              if (channelUid) {
                // Determine per-chat amount from settings (default 1)
                let perChat = 1;
                let pointSettings = {};
                try {
                  pointSettings = await getBotSettings(sid) || {};
                  perChat = Math.max(0, Number(pointSettings.channelPointsPerChat ?? 1));
                } catch { }
                // Skip awarding to owner or bot self
                let ownerUserId = null;
                try { const owner = await getOwnerInfoForSid(sid); ownerUserId = owner?.userId ? String(owner.userId) : null; } catch { }
                if (perChat > 0 && resolvedUserId && String(resolvedUserId) !== String(ownerUserId) && !isBotSelf && !(await isChannelPointExcluded(pointSettings, resolvedUserId))) {
                  try { await incrChannelPoints(channelUid, resolvedUserId, resolvedUsername, perChat); } catch { }
                }
              }
            }

            // (moved below) roulette placeholder handling will occur after responseToSend is defined
          } catch { }

          // Global bot enable gate: if disabled, skip rule processing by loading no rules
          let botDisabled = false;
          try {
            const settings = await getBotSettings(sid) || {};
            if (settings.botEnabled === false) botDisabled = true;
          } catch { }
          if (!botDisabled) {
            try {
              const channelUid = await resolveStreamerUidForSid(sid);
              const predictionReply = await handlePredictionBetCommand({
                sid,
                channelUid,
                userId: resolvedUserId,
                username: resolvedUsername,
                provider: 'chzzk',
                text,
              });
              if (predictionReply) {
                const accessToken = await getValidAccessToken(sid);
                if (entry.sessionKey && accessToken) {
                  await axios.post(`${OPENAPI_BASE}/open/v1/chats/send`, { message: predictionReply }, {
                    params: { sessionKey: entry.sessionKey },
                    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
                  }).catch(() => { });
                  rememberOutboundMessage(entry, predictionReply);
                }
                return;
              }
            } catch (e) {
              console.error('[Prediction] CHZZK command error', e?.message || e);
            }
          }

          // Load per-user rules (empty if disabled)
          const rules = botDisabled ? [] : await getBotRulesWithDefaults(sid);
          if (!Array.isArray(rules)) {
            throw new Error('rules is not iterable');
          }
          const lower = text.toLowerCase();
          // Find first matching rule by startsWith
          const now = Date.now();
          const code = (msg && (msg.userRoleCode ?? msg?.profile?.userRoleCode)) ?? 0;
          const roleLevel = (() => {
            // Accept both numeric and string codes defensively
            const c = typeof code === 'string' ? code.toLowerCase() : code;
            if (c === 4 || c === 'streamer') return 4;
            if (c === 3 || c === 'streaming_channel_manager') return 3;
            if (c === 2 || c === 'streaming_chat_manager') return 2;
            return 1; // default ?쇰컲?좎?
          })();
          for (const r of rules) {
            if (!r.enabled) continue;
            // Role permission check
            const required = Number(r.requiredRoleLevel || (r.adminOnly ? 3 : 1));
            if (roleLevel < required) continue;
            const cooldown = Math.max(1000, Number(r.cooldown || 0));
            if (now - (r.lastUsed || 0) < cooldown) continue;
            // Optional: live-only enforcement for rules (r.liveOnly === true)
            if (r.liveOnly === true) {
              try {
                const live = await isSidLive(sid);
                if (!live) continue;
              } catch { /* ignore and treat as not live */ continue; }
            }
            let matchedKeyword = null;
            const matched = (r.keywords || []).some(kw => {
              if (!kw) return false;
              const ok = lower.startsWith(String(kw).toLowerCase());
              if (ok && matchedKeyword == null) matchedKeyword = String(kw);
              return ok;
            });
            if (!matched) continue;

            // Choose a response
            const responses = Array.isArray(r.responses) ? r.responses.filter(Boolean) : [];
            let response = responses[Math.floor(Math.random() * responses.length)];

            // Points cost enforcement per command (default 0)
            let allowExecute = true;
            const commandCost = Math.max(0, Number(r.pointsCost || 0));
            // Some rules (roulette) handle cost after parsing count; detect roulette token in responses
            const isRouletteRule = (Array.isArray(r.responses) ? r.responses : []).some((s) => typeof s === 'string' && /\$\{\s*roulette::/i.test(s));
            let commandPointDelta = 0;
            let commandPointBefore = null;
            let commandPointAfter = null;
            const commandFeatures = [];
            const commandActionJobs = [];

            const executionContext = msg?.executionContext || { source: 'chat', shouldDeductPoints: true };
            const shouldSkipPointsDeduction = executionContext.source === 'roulette' || !executionContext.shouldDeductPoints;

            if (!isRouletteRule && commandCost > 0 && resolvedUserId && !shouldSkipPointsDeduction) {
              try {
                // Resolve streamer channel UID (same as other points operations)
                let channelUid = null;
                const s = await getBotSettings(sid) || {};
                const uids = await resolveChzzkChannelUidsForSid(sid, s);
                if (uids.length) channelUid = uids[0];
                if (channelUid) {
                  const have = await getChannelPoints(channelUid, String(resolvedUserId)).catch(() => 0);
                  if (Number(have || 0) < commandCost) {
                    // Not enough points: override response and block execution
                    response = `포인트가 부족합니다. (${commandCost} 필요, ${Number(have || 0)} 보유 중)`;
                    allowExecute = false;
                  } else {
                    // Deduct cost now
                    await incrChannelPoints(channelUid, String(resolvedUserId), String(resolvedUsername || ''), -commandCost);
                    commandPointDelta -= commandCost;
                    commandPointBefore = Number(have || 0);
                    commandPointAfter = Number(have || 0) - commandCost;
                  }
                }
              } catch { }
            }

            // Substitute placeholders (live/channel/user)
            try {
              response = await substituteAllPlaceholders(response, sid, resolvedUserId, resolvedUsername);
            } catch { }

            // Prepare args for trigger handling (remove matched keyword from start)
            const restForVd = text.slice((matchedKeyword || '').length).trim();
            const argsVd = restForVd.length ? restForVd.split(/\s+/).map(String) : [];

            // Special trigger: ${video_donation} -> enqueue video donation instead of printing token
            const vdRe = /\$\{\s*video_donation\s*\}/i;
            const vdReAll = /\$\{\s*video_donation\s*\}/ig;
            let responseToSend = response;
            let ruleUsed = false; // mark when this rule executed (even if no chat message output)
            if (allowExecute && typeof response === 'string' && vdRe.test(response)) {
              // args were parsed above as 'args' from user message
              const firstArg = Array.isArray(argsVd) ? (argsVd[0] || '') : '';
              
              // URL, supported clip URL, YouTube URL, or 11-character video ID.
              const looksLikeUrl = /^https?:\/\//i.test(firstArg) || /youtu/i.test(firstArg) || /tiktok/i.test(firstArg) || /chzzk/i.test(firstArg) || /ci\.me/i.test(firstArg) || /^[A-Za-z0-9_-]{11}$/.test(firstArg);
              
              const urlArg = looksLikeUrl ? firstArg : (Array.isArray(argsVd) ? argsVd.join(' ') : firstArg);
              
              if (urlArg) {
                try {
                  responseToSend = await enqueueVideoDonationFromArgs({
                    sid,
                    channelUid: null,
                    userId: resolvedUserId,
                    username: resolvedUsername,
                    args: argsVd,
                    response,
                    vdReAll,
                    context: {
                      source: 'chat-command',
                      provider: 'chzzk',
                      command: { keyword: matchedKeyword || '', ruleId: r.id || null, ruleName: r.name || null },
                    },
                  });
                  commandFeatures.push('video_donation');
                } catch (e) {
                  responseToSend = '요청 처리 중 오류가 발생했습니다.';
                }
              } else {
                responseToSend = (String(response).replace(vdReAll, '').trim() || '링크를 입력해 주세요.');
              }
            }

            // Special trigger: ${roulette::name} -> start a roulette spin and avoid echoing the token
            const rlRe = /\$\{\s*roulette::([^}]+)\s*\}/i;
            const rlReAll = /\$\{\s*roulette::([^}]+)\s*\}/ig;
            if (typeof responseToSend === 'string' && rlRe.test(responseToSend)) {
              try {
                const m = String(responseToSend).match(rlRe);
                const name = m && m[1] ? String(m[1]).trim() : '';
                // Always strip token to avoid echo
                responseToSend = String(responseToSend).replace(rlReAll, '').trim() || (name ? '' : '룰렛 이름이 필요합니다.');
                // Parse count from args: after command keyword, first numeric token; clamp to [1,10]; default 1
                let count = 1;
                try {
                  const rest = text.slice((matchedKeyword || '').length).trim();
                  const t = rest.split(/\s+/).map(String).filter(Boolean);
                  if (t.length >= 1) {
                    const n = parseInt(t[0], 10);
                    if (Number.isFinite(n)) {
                      count = Math.max(1, Math.min(10, n));
                    } else {
                      count = 1;
                    }
                  }
                } catch { count = 1; }
                if (name && allowExecute) {
                  // If this rule has commandCost, charge count*cost now (we skipped earlier for roulette)
                  if (commandCost > 0 && resolvedUserId && !shouldSkipPointsDeduction) {
                    try {
                      // Resolve channel UID strictly; if missing, block execution
                      let channelUid = null;
                      const s = await getBotSettings(sid) || {};
                      const uids = await resolveChzzkChannelUidsForSid(sid, s);
                      if (uids.length) channelUid = uids[0];
                      if (!channelUid) {
                        responseToSend = '포인트 확인에 실패했습니다. 채널 연결을 확인한 뒤 다시 시도해 주세요.';
                        allowExecute = false;
                      } else {
                        const need = commandCost * count;
                        let haveNum = 0;
                        try {
                          const have = await getChannelPoints(channelUid, String(resolvedUserId));
                          haveNum = Number(have || 0);
                        } catch (e) {
                          responseToSend = '포인트 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
                          allowExecute = false;
                        }
                        if (allowExecute) {
                          if (haveNum < need) {
                            responseToSend = `포인트가 부족합니다. (${need} 필요, ${haveNum} 보유 중)`;
                            allowExecute = false;
                          } else {
                            try {
                              await incrChannelPoints(channelUid, String(resolvedUserId), String(resolvedUsername || ''), -need);
                              commandPointDelta -= need;
                              commandPointBefore = haveNum;
                              commandPointAfter = haveNum - need;
                            } catch (e) {
                              responseToSend = '포인트 차감에 실패했습니다. 잠시 후 다시 시도해 주세요.';
                              allowExecute = false;
                            }
                          }
                        }
                      }
                    } catch (e) {
                      console.error(e);
                      responseToSend = '포인트 처리 중 오류가 발생했습니다.';
                      allowExecute = false;
                    }
                  }
                  // Only enqueue if execution is still allowed after points checks
                  if (allowExecute) {
                    try {
                      const accessToken = await getValidAccessToken(sid);

                      const settings = await getBotSettings(sid) || {};
                      let token = typeof settings.rouletteViewerToken === 'string' && settings.rouletteViewerToken.trim()
                        ? String(settings.rouletteViewerToken).trim()
                        : '';

                      if (!token) {
                        token = 'rlt_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
                        try {
                          const next = { ...settings, rouletteViewerToken: token };
                          await setBotSettings(sid, next);
                          console.log(`[Roulette] Created new token for sid: ${sid}, token: ${token}`);
                        } catch (e) {
                          console.error('[Roulette] Failed to save new token:', e);
                        }
                      }

                      rouletteTokenToSid.set(token, sid);
                      console.log(`[Roulette] Token mapping set: ${token} -> ${sid}`);

                      const base = {
                        name,
                        userId: String(resolvedUserId || ''),
                        username: String(resolvedUsername || ''),
                        // For batches (count>1), suppress per-spin chat and tag batch meta; for single spin, allow per-spin chat
                        chatPost: count > 1
                          ? { sessionKey: entry.sessionKey, accessToken, resolvedUsername, suppressResultChat: true, batchId: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, batchCount: count }
                          : { sessionKey: entry.sessionKey, accessToken, resolvedUsername }
                      };

                      console.log(`[Roulette] Enqueueing ${count} spins for roulette: ${name}, user: ${resolvedUsername}`);

                      // First spin: normal animation (instant=false)
                      const queuePosition = enqueueRouletteSpin(sid, {
                        ...base,
                        instant: false,
                        eventContext: {
                          source: 'chat-command',
                          triggerName: matchedKeyword || '',
                          pointDelta: commandPointDelta,
                          pointBefore: commandPointBefore,
                          pointAfter: commandPointAfter,
                        },
                      });
                      console.log(`[Roulette] First spin enqueued at position: ${queuePosition}`);

                      // Remaining spins (if any): instant display on viewer
                      for (let i = 1; i < count; i++) {
                        const pos = enqueueRouletteSpin(sid, { ...base, instant: true, eventContext: { source: 'chat-command', triggerName: matchedKeyword || '' } });
                        console.log(`[Roulette] Spin ${i + 1} enqueued at position: ${pos}`);
                      }

                      responseToSend = '';
                      commandFeatures.push('roulette');

                    } catch (e) {
                      console.error('[Roulette] Execution error:', e);
                      responseToSend = '룰렛 실행 중 오류가 발생했습니다: ' + String(e?.message || e);
                    }
                  }
                }
                ruleUsed = true;
              } catch (e) {
                responseToSend = '룰렛 실행 중 오류가 발생했습니다: ' + String(e?.message || e);
              }
            }

            if (allowExecute && typeof responseToSend === 'string') {
              const actionResult = await executeAndStripActionVariableTokens(sid, responseToSend, {
                source: 'chat-command',
                platform: 'chzzk',
                command: { keyword: matchedKeyword || '', text, ruleId: r.id || null, ruleName: r.name || null },
                user: { userId: resolvedUserId, username: resolvedUsername },
                chatPost: makeChzzkChatPost(entry.sessionKey, null, resolvedUsername),
                channelUid: liveState.channelId || entry.channelId || null,
                channel: { channelUid: liveState.channelId || entry.channelId || null },
              });
              if (actionResult.used) {
                responseToSend = actionResult.text;
                ruleUsed = true;
                commandFeatures.push('action');
                commandActionJobs.push(...(actionResult.jobs || []));
              }
            }

            // Emit WARUDO command event only if execution is allowed (enough points)
            if (allowExecute) {
              try {
                const cmd = matchedKeyword || '';
                // parse args: remove the matched keyword from the start and split by whitespace
                const rest = text.slice(cmd.length).trim();
                const args = rest.length ? rest.split(/\s+/).map(String) : [];
                let ownerPid = null;
                try { const owner = await getOwnerInfoForSid(sid); if (owner?.channelId) ownerPid = `user:${String(owner.channelId)}`; } catch { }
                if (ownerPid) {
                  const payload = {
                    type: 'command',
                    cmd,
                    args,
                    from: { userId: resolvedUserId, username: resolvedUsername },
                    at: Date.now(),
                    source: executionContext.source || 'chat',
                    executionContext: {
                      ...executionContext,
                      pointsDeducted: !shouldSkipPointsDeduction && commandCost > 0,
                      commandCost: commandCost
                    }
                  };
                  try {
                    emitWarudoEvent(ownerPid, payload);
                    console.log(`[Command] Emitted WARUDO event:`, {
                      cmd,
                      source: payload.source,
                      pointsDeducted: payload.executionContext.pointsDeducted,
                      cost: payload.executionContext.commandCost
                    });
                  } catch { };
                  // Also forward to Electron desktop clients subscribed via /api/desktop/ws
                  try {
                    broadcastToDesktop(ownerPid, {
                      type: 'command',
                      cmd,
                      args,
                      from: { userId: resolvedUserId, username: resolvedUsername },
                      at: Date.now(),
                      source: executionContext.source === 'roulette' ? 'arubot-roulette' : 'arubot-chat',
                      metadata: {
                        executionContext: executionContext,
                        pointsDeducted: !shouldSkipPointsDeduction && commandCost > 0,
                        commandCost: commandCost
                      }
                    });
                  } catch { }
                }
              } catch { }
            }

            // Ensure we have sessionKey and access token
            if (!entry.sessionKey) break;
            const accessToken = await getValidAccessToken(sid);
            const url = `${OPENAPI_BASE}/open/v1/chats/send`;
            try {
              const finalMsg = responseToSend;
              // Guard: ensure we reply only once per source chat
              if (!entry.sentReplies) entry.sentReplies = new Set();
              const replyKey = makeCommandReplyKey(msg || ev || {}, r, matchedKeyword || '', text, resolvedUserId);
              const ch = String(entry?.channelId || '');
              // Global guard as well (per channel)
              let alreadyGlobal = false;
              if (ch && replyKey) {
                let set = globalSentReplies.get(ch);
                if (!set) { set = new Set(); globalSentReplies.set(ch, set); }
                if (set.has(replyKey)) alreadyGlobal = true; else set.add(replyKey);
                if (set.size > 5000) { let i = 0; for (const k of set) { set.delete(k); if (++i >= 100) break; } }
              }
              if (finalMsg && String(finalMsg).length > 0 && !entry.sentReplies.has(replyKey) && !alreadyGlobal) {
                entry.sentReplies.add(replyKey);
                await axios.post(url, { message: finalMsg }, {
                  params: { sessionKey: entry.sessionKey },
                  headers: { Authorization: `Bearer ${accessToken}` }
                });
              }
              // Update lastUsed regardless of whether a message was sent if the rule was used
              if (ruleUsed || (finalMsg && String(finalMsg).length > 0)) {
                try { await upsertBotRule(sid, { ...r, lastUsed: now }); } catch { }
              }
              await recordCommandExecutionLog(sid, {
                executed: allowExecute && (ruleUsed || (finalMsg && String(finalMsg).length > 0)),
                provider: 'chzzk',
                channelUid: liveState.channelId || entry.channelId || null,
                userId: resolvedUserId,
                username: resolvedUsername,
                triggerName: matchedKeyword || '',
                targetName: r.name || null,
                ruleId: r.id || null,
                ruleName: r.name || null,
                args: argsVd,
                pointDelta: commandPointDelta,
                pointBefore: commandPointBefore,
                pointAfter: commandPointAfter,
                features: commandFeatures,
                actionJobs: commandActionJobs,
                source: executionContext.source || 'chat',
                summary: `명령어 실행: ${matchedKeyword || ''}${r.name ? ` · ${r.name}` : ''}`,
              });
            } catch (e) {
              console.error('Backend auto-reply send error', e?.response?.data || e.message);
            }

            // Send only one matching rule per message
            break;
          }
        } catch (e) {
          console.error('Backend rule processing error', e?.message || e);
        }
      })();
    });

    socket.on('DONATION', (raw) => {
      const msg = (typeof raw === 'string') ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : raw;
      const ev = {
        type: 'donation',
        id: `${Date.now()}_${Math.random()}`,
        ts: Date.now(),
        user: msg?.donatorNickname || '?듬챸',
        id: msg?.donatorChannelId || '',
        amount: msg?.payAmount,
        message: msg?.donationText || '',
        raw: msg,
      };
      pushEvent(entry, ev);
      // Process donation: award channel points and trigger donation rules
      (async () => {
        try {
          const sid = [...sessionStore.entries()].find(([, e]) => e === entry)?.[0];
          if (!sid) return;
          const liveState = await refreshChzzkLiveStatusForSid(sid, { ttlMs: 5000 });
          if (!liveState.live) return;
          const amount = Math.max(0, Number(ev.amount || 0));
          const donorName = String(ev.user || '?듬챸');
          const donorId = String(ev.id || '');
          const donorMessage = String(ev.message || '');
          // 1) Award channel points
          try {
            const settings = await getBotSettings(sid) || {};
            const pointsPerK = Math.max(0, Number(settings?.donation?.pointsPerK ?? 10));
            const award = Math.floor((amount / 1000) * pointsPerK);
            if (award > 0) {
              // Resolve streamer channel UID
              let channelUid = null;
              const uids = await resolveChzzkChannelUidsForSid(sid, settings);
              if (uids.length) channelUid = uids[0];
              if (channelUid) {
                // Use donor's userId (channel id) as the points subject
                const pointsUserId = donorId || `donor:${donorName}`;
                if (!(await isChannelPointExcluded(settings, pointsUserId))) {
                  try { await incrChannelPoints(channelUid, String(pointsUserId), donorName, award); } catch { }
                }
              }
            }
          } catch { }

          // 2) Find ALL matching donation rules
          const responsesToSend = [];
          try {
            const settings = await getBotSettings(sid) || {};
            const rules = Array.isArray(settings.donationRules) ? settings.donationRules : [];
            const lowerMsg = donorMessage.toLowerCase();
            for (const r of rules) {
              if (!r || r.enabled === false) continue;
              if (!donationRuleMatchesAmount(r, amount)) continue;
              const pat = String(r.message || '').trim();
              const wildcard = !!r.wildcard;
              let passed = true;
              if (pat) {
                const needle = pat.toLowerCase();
                passed = wildcard ? lowerMsg.includes(needle) : lowerMsg.startsWith(needle);
              }
              if (!passed) continue;

              // Emit desktop command if rule has a name
              try {
                const name = String(r.name || '').trim();
                if (name) {
                  const repeatEnabled = !!r.repeatEnabled;
                  const repeatPerAmount = repeatEnabled && r.repeatPerAmount ? Math.max(1, Number(r.repeatPerAmount)) : null;
                  const repeatCooldown = repeatEnabled ? Math.max(0, Number(r.repeatCooldown || 0)) : 0;

                  if (repeatEnabled && repeatPerAmount && amount >= repeatPerAmount) {
                    const repeatCount = Math.floor(amount / repeatPerAmount);
                    
                    (async () => {
                      for (let i = 0; i < repeatCount; i++) {
                        try {
                          broadcastToDesktop(sid, {
                            type: 'command',
                            cmd: name,
                            args: [],
                            from: { userId: donorId ? String(donorId) : '', username: donorName },
                            amount: amount,
                            repeatIndex: i + 1,
                            repeatTotal: repeatCount,
                            at: Date.now(),
                            source: 'donation-rule'
                          });
                        } catch { }
                        
                        if (i < repeatCount - 1 && repeatCooldown > 0) {
                          await new Promise(resolve => setTimeout(resolve, repeatCooldown));
                        }
                      }
                    })();
                  } else {
                    try {
                      broadcastToDesktop(sid, {
                        type: 'command',
                        cmd: name,
                        args: [],
                        from: { userId: donorId ? String(donorId) : '', username: donorName },
                        amount: amount,
                        at: Date.now(),
                        source: 'donation-rule'
                      });
                    } catch { }
                  }
                }
              } catch { }

              // Build response with variables
              const tmpl = String(r.response || '').trim();
              const vars = {
                username: donorName,
                amount: amount,
                message: donorMessage,
              };
              let built = tmpl.replace(/\$\{\s*(username|amount|message)\s*\}/g, (_, k) => String(vars[k]));
              // Apply global placeholders like {live.*}, {channel.*}, {user.*}
              try {
                built = await substituteAllPlaceholders(built, sid, donorId ? String(donorId) : '', donorName || '');
              } catch { }
              const donationFeatures = [];
              // Handle optional roulette trigger inside response
              const rlRe = /\$\{\s*roulette::([^}]+)\s*\}/i;
              const rlReAll = /\$\{\s*roulette::([^}]+)\s*\}/ig;
              if (rlRe.test(built)) {
                try {
                  const m = String(built).match(rlRe);
                  const name = m && m[1] ? String(m[1]).trim() : '';
                  built = String(built).replace(rlReAll, '').trim();
                  if (name) {
                    // Enqueue a single spin (no cost in donation flow)
                    const accessToken = await getValidAccessToken(sid);
                    const base = {
                      name,
                      userId: donorId ? String(donorId) : '',
                      username: donorName,
                      chatPost: { sessionKey: entry.sessionKey, accessToken, resolvedUsername: donorName }
                    };
                    enqueueRouletteSpin(sid, { ...base, instant: false, eventContext: { source: 'donation-rule', triggerName: r.name || null } });
                    donationFeatures.push('roulette');
                  }
                } catch { }
              }
              await recordDonationRuleExecutionLog(sid, {
                provider: 'chzzk',
                channelUid: liveState.channelId || null,
                userId: donorId ? String(donorId) : null,
                username: donorName,
                ruleId: r.id || null,
                ruleName: r.name || null,
                targetName: donationFeatures.includes('roulette') ? '룰렛 실행' : '채팅 반응',
                amount,
                message: donorMessage,
                features: donationFeatures,
                source: 'donation-rule',
                summary: `후원 반응 실행: ${r.name || '이름 없음'} · ${amount.toLocaleString('ko-KR')}원`,
              });
              if (built && built.length > 0) responsesToSend.push(built);
            }
          } catch { }

          // 3) Send chat for every matched rule (separately)
          try {
            if (!entry.sessionKey) return;
            const accessToken = await getValidAccessToken(sid);
            const url = `${OPENAPI_BASE}/open/v1/chats/send`;
            for (const msgText of responsesToSend) {
              if (!msgText || !msgText.length) continue;
              await axios.post(url, { message: msgText }, {
                params: { sessionKey: entry.sessionKey },
                headers: { Authorization: `Bearer ${accessToken}` }
              }).catch(() => { });
              // small delay to avoid rate limits
              await new Promise(r => setTimeout(r, 120));
            }
          } catch { }
        } catch { }
      })();
    });

    socket.on('SUBSCRIPTION', (raw) => {
      const msg = (typeof raw === 'string') ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : raw;
      const ev = {
        type: 'subscription',
        id: `${Date.now()}_${Math.random()}`,
        ts: Date.now(),
        user: msg?.subscriberNickname || '?듬챸',
        id: msg?.subscriberChannelId || '',
        months: msg?.month,
        message: `${msg?.tierName || ''}`,
        raw: msg,
      };
      pushEvent(entry, ev);
    });

    socket.on('disconnect', () => {
      entry.connected = false;
    });

    socket.on('error', (err) => {
      console.error('[CHZZK socket error]', err);
    });

    return entry;
  })();

  sessionCreatePromises.set(sid, createPromise);
  try {
    const created = await createPromise;
    await ensureSubscribed(created, sid, channelId);
    return created;
  } finally {
    sessionCreatePromises.delete(sid);
  }
}

async function ensureSubscribed(entry, sid, channelId) {
  // Subscriptions are per user session in CHZZK docs; channelId is not required for subscribe endpoints.
  if (entry.subscribed.has('ALL')) return;
  if (entry.subscribing) return entry.subscribing;
  entry.subscribing = (async () => {
  // Ensure sessionKey is available (SYSTEM connected processed)
  if (!entry.sessionKey) {
    // wait briefly for the SYSTEM connected message
    const start = Date.now();
    while (!entry.sessionKey && Date.now() - start < 8000) {
      await new Promise(r => setTimeout(r, 50));
    }
  }
  if (!entry.sessionKey) throw new Error('No sessionKey yet');
  const accessToken = await getValidAccessToken(sid);
  await subscribeEvent('chat', entry.sessionKey, undefined, accessToken);
  await subscribeEvent('donation', entry.sessionKey, undefined, accessToken);
  await subscribeEvent('subscription', entry.sessionKey, undefined, accessToken);
  entry.subscribed.add('ALL');
  })();
  try {
    return await entry.subscribing;
  } finally {
    entry.subscribing = null;
  }
}

function pushEvent(entry, ev) {
  entry.queue.push(ev);
  if (entry.queue.length > MAX_QUEUE) entry.queue.splice(0, entry.queue.length - MAX_QUEUE);
}

async function subscribeEvent(kind, sessionKey, channelId, accessToken) {
  const map = {
    chat: '/open/v1/sessions/events/subscribe/chat',
    donation: '/open/v1/sessions/events/subscribe/donation',
    subscription: '/open/v1/sessions/events/subscribe/subscription',
  };
  const url = `${OPENAPI_BASE}${map[kind]}`;
  try {
    await axios.post(url, null, {
      params: { sessionKey },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (e) {
    console.error(`[CHZZK subscribe ${kind} error] url=${url} params=${JSON.stringify({ sessionKey })} resp=`, e?.response?.data || e.message);
    throw e;
  }
}

async function getYoutubeChannelId(ownerUserId) {
  const streamerChannel = await getYoutubeStreamerChannel(ownerUserId).catch(() => null);
  if (streamerChannel?.youtubeChannelId) return String(streamerChannel.youtubeChannelId);
  const accountChannelId = await resolveChannelIdForOwnerUserId(ownerUserId, { provider: 'youtube', allowFallback: false });
  if (accountChannelId) return accountChannelId;
  const tokens = await getPlatformTokens('youtube', ownerUserId);
  if (tokens?.platformUserId) return String(tokens.platformUserId);
  return null;
}

function normalizeYoutubeLiveBroadcast(item) {
  const snippet = item?.snippet || {};
  const status = item?.status || {};
  const details = item?.liveStreamingDetails || {};
  const startedCandidate = details.actualStartTime || snippet.actualStartTime || snippet.scheduledStartTime || null;
  const startedAtTs = startedCandidate ? Date.parse(startedCandidate) : null;
  return {
    provider: 'youtube',
    broadcastId: item?.id || null,
    liveChatId: snippet.liveChatId || null,
    status: status.lifeCycleStatus || '',
    title: snippet.title || '',
    category: '',
    viewers: null,
    startedAt: startedCandidate || null,
    startedAtTs: Number.isFinite(startedAtTs) ? startedAtTs : null,
    channel: snippet.channelTitle || '',
    live: true,
    raw: item || {}
  };
}

function isYoutubeLiveBroadcastActive(item) {
  const status = String(item?.status?.lifeCycleStatus || item?.status || '').toLowerCase();
  if (!status) return true;
  return status === 'live' || status === 'active' || status.includes('live');
}

async function fetchYoutubeActiveLive(ownerUserId, options = {}) {
  const centralLive = await refreshYoutubeLiveFromRegisteredChannel(ownerUserId, { allowSearch: options.allowSearch === true }).catch(() => null);
  if (centralLive?.liveChatId) return centralLive;
  const botProfile = await getYoutubeBotProfile(YOUTUBE_BOT_PROFILE_ID).catch(() => null);
  const streamerChannel = await getYoutubeStreamerChannel(ownerUserId).catch(() => null);
  if (botProfile?.selectedChannelId || streamerChannel?.youtubeChannelId) return centralLive || null;
  let response = null;
  try {
    response = await youtubeApiGet('liveBroadcasts', ownerUserId, {
      part: 'snippet,status,contentDetails',
      mine: 'true',
      broadcastStatus: 'active',
      maxResults: 5
    });
  } catch (error) {
    const message = String(error?.response?.data?.error?.message || error?.message || '');
    if (!message.toLowerCase().includes('incompatible parameters')) throw error;
    response = await youtubeApiGet('liveBroadcasts', ownerUserId, {
      part: 'snippet,status,contentDetails',
      mine: 'true',
      maxResults: 5
    });
  }
  const items = Array.isArray(response?.data?.items) ? response.data.items : [];
  const active = items
    .map(normalizeYoutubeLiveBroadcast)
    .filter((item) => item.broadcastId && item.liveChatId && isYoutubeLiveBroadcastActive(item))
    .sort((a, b) => Number(b.startedAtTs || 0) - Number(a.startedAtTs || 0));
  return active[0] || null;
}

async function refreshYoutubeLiveStatus(ownerUserId, sid, options = {}) {
  const normalizedSid = sid || `user:${ownerUserId}`;
  const now = Date.now();
  const cached = liveStatusCache.get(normalizedSid);
  const ttlMs = Number.isFinite(Number(options.ttlMs)) ? Number(options.ttlMs) : 30 * 1000;
  if (!options.force && cached?.provider === 'youtube' && (now - cached.ts) < ttlMs) {
    return { live: !!cached.live, channelId: cached.channelId || null, liveChatId: cached.liveChatId || null, startTs: cached.startTs || null, cached: true };
  }

  let liveInfo = null;
  try {
    liveInfo = await fetchYoutubeActiveLive(ownerUserId, { allowSearch: options.force === true || options.allowSearch === true });
  } catch (e) {
    console.warn('[YouTube] Active live lookup failed:', e?.response?.data?.error?.message || e?.message || e);
  }

  const channelId = await getYoutubeChannelId(ownerUserId).catch(() => null);
  const live = !!liveInfo?.liveChatId;
  const startTs = liveInfo?.startedAtTs || null;
  liveStatusCache.set(normalizedSid, {
    ts: now,
    live,
    provider: 'youtube',
    channelId,
    liveChatId: liveInfo?.liveChatId || null,
    broadcastId: liveInfo?.broadcastId || null,
    title: liveInfo?.title || '',
    startTs
  });

  const previousLive = cached?.provider === 'youtube' ? !!cached.live : undefined;
  const cachedSession = liveSession.get(normalizedSid);
  const shouldPersistSessionState = live
    ? previousLive !== true || !cachedSession?.live || (now - Number(cachedSession?.lastUpdate || 0)) > 60 * 1000
    : previousLive === true || !!cachedSession?.live;
  if (shouldPersistSessionState) {
    try { await updateSessionState(normalizedSid, live, startTs || now); } catch { }
  }

  return { live, channelId, liveChatId: liveInfo?.liveChatId || null, broadcastId: liveInfo?.broadcastId || null, title: liveInfo?.title || '', startTs };
}

function normalizeYoutubeChatEvent(item) {
  const snippet = item?.snippet || {};
  const author = item?.authorDetails || {};
  const text = snippet.textMessageDetails?.messageText || snippet.displayMessage || '';
  const ts = snippet.publishedAt ? Date.parse(snippet.publishedAt) : Date.now();
  return {
    type: 'chat',
    provider: 'youtube',
    id: String(item?.id || `${author.channelId || 'chat'}:${snippet.publishedAt || Date.now()}:${String(text).slice(0, 80)}`),
    ts: Number.isFinite(ts) ? ts : Date.now(),
    user: author.displayName || 'Unknown',
    userId: author.channelId || snippet.authorChannelId || '',
    message: text,
    role: {
      owner: author.isChatOwner === true,
      moderator: author.isChatModerator === true,
      sponsor: author.isChatSponsor === true,
      verified: author.isVerified === true
    },
    raw: item
  };
}

function normalizeYoutubeSuperChatEvent(item) {
  const snippet = item?.snippet || {};
  const details = snippet.superChatDetails || {};
  const author = item?.authorDetails || {};
  const currency = String(details.currency || '').toUpperCase();
  const amountMicros = Number(details.amountMicros || 0);
  const ts = snippet.publishedAt ? Date.parse(snippet.publishedAt) : Date.now();
  const base = {
    provider: 'youtube',
    id: String(item?.id || `${author.channelId || 'superchat'}:${snippet.publishedAt || Date.now()}`),
    ts: Number.isFinite(ts) ? ts : Date.now(),
    user: author.displayName || 'Unknown',
    userId: author.channelId || snippet.authorChannelId || '',
    amountMicros,
    currency,
    amountDisplayString: details.amountDisplayString || '',
    message: details.userComment || '',
    raw: item
  };
  if (currency !== 'KRW') {
    return { ...base, type: 'donation_ignored', ignoredReason: 'non_krw_super_chat' };
  }
  if (!Number.isFinite(amountMicros) || amountMicros <= 0) {
    return { ...base, type: 'donation_ignored', ignoredReason: 'invalid_super_chat_amount' };
  }
  return {
    ...base,
    type: 'donation',
    donationType: 'youtube_super_chat',
    amount: Math.floor(amountMicros / 1000000),
    currency: 'KRW'
  };
}

function normalizeYoutubeLiveChatItem(item) {
  const type = String(item?.snippet?.type || '');
  if (type === 'textMessageEvent') return { eventName: 'CHAT', ev: normalizeYoutubeChatEvent(item) };
  if (type === 'superChatEvent') {
    const ev = normalizeYoutubeSuperChatEvent(item);
    return { eventName: ev.type === 'donation' ? 'DONATION' : 'DONATION_IGNORED', ev };
  }
  if (type === 'superStickerEvent') {
    const snippet = item?.snippet || {};
    const author = item?.authorDetails || {};
    const ts = snippet.publishedAt ? Date.parse(snippet.publishedAt) : Date.now();
    return {
      eventName: 'DONATION_IGNORED',
      ev: {
        type: 'donation_ignored',
        provider: 'youtube',
        ignoredReason: 'super_sticker_not_supported',
        id: String(item?.id || `${author.channelId || 'sticker'}:${snippet.publishedAt || Date.now()}`),
        ts: Number.isFinite(ts) ? ts : Date.now(),
        user: author.displayName || 'Unknown',
        userId: author.channelId || snippet.authorChannelId || '',
        message: snippet.displayMessage || '',
        raw: item
      }
    };
  }
  return null;
}

function getYoutubeChatLibraryMessageText(chatItem = {}) {
  return (Array.isArray(chatItem.message) ? chatItem.message : [])
    .map((part) => {
      if (typeof part?.text === 'string') return part.text;
      return String(part?.emojiText || part?.alt || '');
    })
    .join('');
}

function parseYoutubeChatLibraryAmount(amountText) {
  const raw = String(amountText || '').trim();
  const upper = raw.toUpperCase();
  let currency = '';
  if (/[₩원]/.test(raw) || upper.includes('KRW')) currency = 'KRW';
  else if (upper.includes('JPY') || /[¥￥]/.test(raw)) currency = 'JPY';
  else if (upper.includes('USD') || raw.includes('$')) currency = 'USD';
  else if (upper.includes('EUR') || raw.includes('€')) currency = 'EUR';
  else if (upper.includes('GBP') || raw.includes('£')) currency = 'GBP';

  const numericText = raw.replace(/[^\d.,-]/g, '');
  if (!numericText) return { currency, amountMicros: 0 };

  let amount = 0;
  if (currency === 'KRW' || currency === 'JPY') {
    amount = Number(numericText.replace(/[^\d-]/g, ''));
  } else {
    const lastComma = numericText.lastIndexOf(',');
    const lastDot = numericText.lastIndexOf('.');
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const normalized = numericText
      .replace(decimalSeparator === ',' ? /\./g : /,/g, '')
      .replace(decimalSeparator === ',' ? ',' : '.', '.');
    amount = Number(normalized);
  }

  return {
    currency,
    amountMicros: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 1000000) : 0
  };
}

function normalizeYoutubeChatLibraryItem(chatItem) {
  if (!chatItem || typeof chatItem !== 'object') return null;
  const message = getYoutubeChatLibraryMessageText(chatItem);
  const author = chatItem.author || {};
  const timestamp = chatItem.timestamp instanceof Date ? chatItem.timestamp : new Date(chatItem.timestamp || Date.now());
  const ts = Number.isFinite(timestamp.getTime()) ? timestamp.getTime() : Date.now();
  const publishedAt = new Date(ts).toISOString();
  const id = String(chatItem.id || `${author.channelId || 'youtube-chat'}:${publishedAt}:${String(message).slice(0, 80)}`);
  const authorDetails = {
    channelId: author.channelId || '',
    displayName: author.name || 'Unknown',
    isVerified: chatItem.isVerified === true,
    isChatOwner: chatItem.isOwner === true,
    isChatSponsor: chatItem.isMembership === true,
    isChatModerator: chatItem.isModerator === true,
    profileImageUrl: author.thumbnail?.url || null
  };

  if (chatItem.superchat?.sticker) {
    return {
      eventName: 'DONATION_IGNORED',
      ev: {
        type: 'donation_ignored',
        provider: 'youtube',
        ignoredReason: 'super_sticker_not_supported',
        id,
        ts,
        user: authorDetails.displayName,
        userId: authorDetails.channelId,
        message,
        amountDisplayString: chatItem.superchat.amount || '',
        raw: chatItem
      }
    };
  }

  if (chatItem.superchat) {
    const amount = parseYoutubeChatLibraryAmount(chatItem.superchat.amount);
    return normalizeYoutubeLiveChatItem({
      id,
      snippet: {
        type: 'superChatEvent',
        publishedAt,
        authorChannelId: authorDetails.channelId,
        displayMessage: message,
        superChatDetails: {
          amountMicros: amount.amountMicros,
          currency: amount.currency,
          amountDisplayString: chatItem.superchat.amount || '',
          userComment: message
        }
      },
      authorDetails,
      youtubeChat: chatItem
    });
  }

  return normalizeYoutubeLiveChatItem({
    id,
    snippet: {
      type: 'textMessageEvent',
      publishedAt,
      authorChannelId: authorDetails.channelId,
      displayMessage: message,
      textMessageDetails: { messageText: message }
    },
    authorDetails,
    youtubeChat: chatItem
  });
}

function makeYoutubeChatPost(ownerUserId, liveChatId, resolvedUsername, extra = {}) {
  return { provider: 'youtube', ownerUserId, liveChatId, resolvedUsername, ...extra };
}

function isYoutubeReauthRequired(entryOrError) {
  if (!entryOrError) return false;
  if (entryOrError.reauthRequired === true) return true;
  const status = Number(entryOrError.status || entryOrError.lastStatus || entryOrError?.response?.status || 0);
  const text = String(entryOrError.lastError || entryOrError.message || entryOrError?.response?.data?.error || '').toLowerCase();
  return status === 401 || text.includes('invalid_grant') || text.includes('unauthorized') || text.includes('no youtube refresh token');
}

function getYoutubeIgnoredDonationSummary(entry) {
  const events = Array.isArray(entry?.queue) ? entry.queue : [];
  const ignored = events
    .filter((event) => event?.provider === 'youtube' && event?.type === 'donation_ignored')
    .slice(-10);
  const byReason = {};
  for (const event of ignored) {
    const reason = String(event.ignoredReason || 'unknown');
    byReason[reason] = (byReason[reason] || 0) + 1;
  }
  return {
    count: ignored.length,
    byReason,
    recent: ignored.slice(-5).map((event) => ({
      ts: event.ts || null,
      user: event.user || null,
      reason: event.ignoredReason || 'unknown',
      currency: event.currency || null,
      amountDisplayString: event.amountDisplayString || null,
      message: event.message || '',
    })),
  };
}

function rememberYoutubeOutbound(entry, text) {
  rememberOutboundMessage(entry, text);
}

function isLikelyYoutubeSelfEcho(entry, ev) {
  if (!entry) return false;
  const authorId = String(ev?.userId || '').trim();
  if (authorId && entry.botChannelId && authorId === String(entry.botChannelId)) return true;
  if (authorId && entry.channelId && authorId === String(entry.channelId) && hasRecentOutboundMessage(entry, ev?.message || '')) return true;
  const text = String(ev?.message || '').trim();
  return !authorId && !!text && hasRecentOutboundMessage(entry, text);
}

function isYoutubeAuthorPrivilegedForModeration(author = {}) {
  return author.isChatModerator === true || author.isChatOwner === true;
}

function serializeYoutubeAuthorDetails(author = {}) {
  return {
    channelId: author.channelId || null,
    displayName: author.displayName || null,
    isVerified: author.isVerified === true,
    isChatOwner: author.isChatOwner === true,
    isChatSponsor: author.isChatSponsor === true,
    isChatModerator: author.isChatModerator === true
  };
}

function serializeYoutubeModeratorDetails(item = {}) {
  const details = item?.snippet?.moderatorDetails || {};
  return {
    id: item?.id || null,
    channelId: details.channelId || null,
    channelUrl: details.channelUrl || null,
    displayName: details.displayName || null,
    profileImageUrl: details.profileImageUrl || null
  };
}

function getYoutubeLiveChatMessageText(item = {}) {
  const snippet = item.snippet || {};
  return String(snippet.textMessageDetails?.messageText || snippet.displayMessage || '');
}

function findYoutubeModeratorVerificationMessage(items, { sentMessageId, marker, botChannelId }) {
  let markerMatch = null;
  for (const item of Array.isArray(items) ? items : []) {
    const author = item?.authorDetails || {};
    const text = getYoutubeLiveChatMessageText(item);
    const matchesMessage = (sentMessageId && String(item?.id || '') === String(sentMessageId))
      || (!!marker && text.includes(marker));
    if (!matchesMessage) continue;

    const matchesBotChannel = !botChannelId || String(author.channelId || '') === String(botChannelId);
    const match = { item, author, text, matchesBotChannel };
    if (matchesBotChannel) return match;
    if (!markerMatch) markerMatch = match;
  }
  return markerMatch;
}

async function fetchYoutubeLiveChatMessages(liveChatId, accessToken) {
  const url = new URL('liveChat/messages', YOUTUBE_API_BASE.endsWith('/') ? YOUTUBE_API_BASE : `${YOUTUBE_API_BASE}/`);
  url.searchParams.set('part', 'id,snippet,authorDetails');
  url.searchParams.set('liveChatId', liveChatId);
  url.searchParams.set('maxResults', '200');
  url.searchParams.set('profileImageSize', '88');
  const response = await axios.get(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    timeout: 7000
  });
  return Array.isArray(response?.data?.items) ? response.data.items : [];
}

async function fetchYoutubeLiveChatModerators(ownerUserId, liveChatId) {
  const accessToken = await getValidYoutubeAccessToken(ownerUserId);
  const items = [];
  let pageToken = null;

  for (let page = 0; page < 10; page += 1) {
    const response = await youtubeApiGetWithAccessToken('liveChat/moderators', accessToken, {
      part: 'id,snippet',
      liveChatId,
      maxResults: 50,
      ...(pageToken ? { pageToken } : {})
    }, { timeout: 7000 });
    const data = response?.data || {};
    if (Array.isArray(data.items)) items.push(...data.items);
    pageToken = data.nextPageToken || null;
    if (!pageToken) break;
  }

  return items;
}

function findYoutubeModeratorByChannelId(items, channelId) {
  if (!channelId) return null;
  return (Array.isArray(items) ? items : []).find((item) => {
    const details = item?.snippet?.moderatorDetails || {};
    return String(details.channelId || '') === String(channelId);
  }) || null;
}

async function waitForYoutubeModeratorVerificationMessage(liveChatId, accessToken, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 7));
  const intervalMs = Math.max(250, Number(options.intervalMs || 1500));
  let lastError = null;
  let lastMarkerMatch = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const items = await fetchYoutubeLiveChatMessages(liveChatId, accessToken);
      const match = findYoutubeModeratorVerificationMessage(items, options);
      if (match?.matchesBotChannel) return { match, attempts: attempt + 1, lastError: null };
      if (match && !lastMarkerMatch) lastMarkerMatch = match;
    } catch (e) {
      lastError = e;
    }
  }

  return { match: lastMarkerMatch, attempts, lastError };
}

async function verifyYoutubeBotModeratorRegistration(ownerUserId) {
  const botProfile = await getValidYoutubeBotProfile();
  const streamerChannel = await getYoutubeStreamerChannel(ownerUserId);
  if (!streamerChannel?.youtubeChannelId) {
    const error = new Error('YouTube streamer channel is not registered');
    error.status = 404;
    error.code = 'youtube_streamer_channel_not_registered';
    throw error;
  }

  const liveInfo = await refreshYoutubeLiveFromRegisteredChannel(ownerUserId, { allowSearch: true }).catch(() => null);
  const liveChatId = liveInfo?.liveChatId || streamerChannel.lastLiveChatId || null;
  if (!liveChatId) {
    return {
      verified: false,
      reason: 'active_live_chat_required',
      message: '운영자 등록 여부는 활성 YouTube Live 채팅이 있을 때만 확인할 수 있습니다.',
      liveChatId: null
    };
  }

  const accessToken = await getValidYoutubeBotAccessToken();
  const marker = `AruBot moderator check ${crypto.randomBytes(4).toString('hex')}`;
  let sentMessageId = null;
  let moderatorListError = null;

  try {
    const moderators = await fetchYoutubeLiveChatModerators(ownerUserId, liveChatId);
    const moderator = findYoutubeModeratorByChannelId(moderators, botProfile.selectedChannelId);
    if (moderator) {
      return {
        verified: true,
        reason: 'moderator_list_verified',
        message: 'AruBot 중앙 봇이 이 라이브 채팅의 운영자로 확인되었습니다.',
        liveChatId,
        botChannelId: botProfile.selectedChannelId,
        checkedBy: 'liveChatModerators.list',
        moderatorDetails: serializeYoutubeModeratorDetails(moderator),
        moderatorsChecked: moderators.length
      };
    }
  } catch (e) {
    const message = e?.response?.data?.error?.message || e?.message || String(e || '');
    const isExpectedCentralBotModeMiss = message === 'No YouTube tokens stored';
    if (!isExpectedCentralBotModeMiss) {
      moderatorListError = e;
      console.warn('[YouTube] Moderator list verification failed:', message);
    }
  }

  try {
    const sent = await youtubeBotApiPost('liveChat/messages', { part: 'snippet' }, {
      snippet: {
        liveChatId,
        type: 'textMessageEvent',
        textMessageDetails: { messageText: marker }
      }
    }, { timeout: 7000 });
    sentMessageId = sent?.data?.id || null;
  } catch (e) {
    const error = new Error(e?.response?.data?.error?.message || e?.message || 'Failed to send YouTube moderator verification message');
    error.status = e?.response?.status || 500;
    error.code = 'moderator_verification_send_failed';
    throw error;
  }

  const observed = await waitForYoutubeModeratorVerificationMessage(liveChatId, accessToken, {
    sentMessageId,
    marker,
    botChannelId: botProfile.selectedChannelId,
    attempts: 8,
    intervalMs: 1250
  });

  if (!observed.match) {
    const result = {
      verified: false,
      reason: observed.lastError ? 'verification_lookup_failed' : 'verification_message_not_observed',
      message: observed.lastError
        ? `검증 메시지 조회 중 오류가 발생했습니다: ${observed.lastError?.response?.data?.error?.message || observed.lastError?.message || 'unknown error'}`
        : '검증 메시지를 YouTube Live Chat 목록에서 확인하지 못했습니다.',
      liveChatId,
      messageId: sentMessageId,
      botChannelId: botProfile.selectedChannelId,
      checkedBy: 'liveChatMessages.list',
      attempts: observed.attempts
    };
    if (moderatorListError) {
      result.moderatorListError = moderatorListError?.response?.data?.error?.message || moderatorListError?.message || 'unknown error';
    }
    console.warn('[YouTube] Moderator verification failed:', result);
    return result;
  }

  const author = observed.match.author || {};
  const authorDetails = serializeYoutubeAuthorDetails(author);
  const verified = observed.match.matchesBotChannel && isYoutubeAuthorPrivilegedForModeration(author);
  let reason = 'moderator_verified';
  let message = 'AruBot 중앙 봇이 이 라이브 채팅의 운영자로 확인되었습니다.';
  if (!observed.match.matchesBotChannel) {
    reason = 'verification_channel_mismatch';
    message = '검증 메시지는 확인했지만 AruBot에 등록된 중앙 봇 채널과 작성자 채널이 다릅니다.';
  } else if (!verified) {
    reason = 'bot_is_not_moderator';
    message = 'AruBot 중앙 봇 메시지는 확인했지만 YouTube API에서 운영자 또는 채널 소유자 권한이 확인되지 않았습니다.';
  }

  const result = {
    verified,
    reason,
    message,
    liveChatId,
    messageId: observed.match.item?.id || sentMessageId,
    botChannelId: botProfile.selectedChannelId,
    observedChannelId: author.channelId || null,
    checkedBy: 'liveChatMessages.list',
    attempts: observed.attempts,
    authorDetails
  };
  if (!verified || moderatorListError) {
    result.moderatorListError = moderatorListError
      ? moderatorListError?.response?.data?.error?.message || moderatorListError?.message || 'unknown error'
      : null;
    console.warn('[YouTube] Moderator verification result:', result);
  }
  return result;
}

async function sendYoutubeChat(ownerUserId, liveChatId, message) {
  const text = String(message || '').trim();
  if (!text) return null;
  const previous = youtubeSendQueues.get(ownerUserId) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    let targetLiveChatId = liveChatId;
    if (!targetLiveChatId) {
      const state = await refreshYoutubeLiveStatus(ownerUserId, `user:${ownerUserId}`, { force: true });
      targetLiveChatId = state.liveChatId;
    }
    if (!targetLiveChatId) throw new Error('No active YouTube liveChatId');
    const messageText = text.slice(0, 200);
    const response = await youtubeBotApiPost('liveChat/messages', { part: 'snippet' }, {
      snippet: {
        liveChatId: targetLiveChatId,
        type: 'textMessageEvent',
        textMessageDetails: { messageText }
      }
    }, { timeout: 7000 });
    rememberYoutubeOutbound(youtubeSessionStore.get(ownerUserId), messageText);
    await new Promise((resolve) => setTimeout(resolve, 750));
    return response?.data || {};
  });
  youtubeSendQueues.set(ownerUserId, task);
  return task;
}

async function processYoutubeDonationAutomation(entry, ev) {
  try {
    if (ev?.currency !== 'KRW') return;
    const ownerUserId = entry.ownerUserId;
    const sid = entry.primarySid || `user:${ownerUserId}`;
    const settings = await getBotSettings(sid) || {};
    const amount = Math.max(0, Number(ev.amount || 0));
    const donorName = String(ev.user || 'Unknown');
    const donorId = String(ev.userId || `youtube-donor:${donorName}`);
    const donorMessage = String(ev.message || '');

    const pointsPerK = Math.max(0, Number(settings?.donation?.pointsPerK ?? 10));
    const award = Math.floor((amount / 1000) * pointsPerK);
    if (award > 0 && entry.channelId && !(await isChannelPointExcluded(settings, donorId))) {
      await incrChannelPoints(entry.channelId, donorId, donorName, award).catch(() => { });
    }

    const responsesToSend = [];
    const rules = Array.isArray(settings.donationRules) ? settings.donationRules : [];
    const lowerMsg = donorMessage.toLowerCase();
    for (const r of rules) {
      if (!r || r.enabled === false) continue;
      if (!donationRuleMatchesAmount(r, amount)) continue;
      const pat = String(r.message || '').trim();
      if (pat) {
        const needle = pat.toLowerCase();
        const passed = r.wildcard ? lowerMsg.includes(needle) : lowerMsg.startsWith(needle);
        if (!passed) continue;
      }

      const name = String(r.name || '').trim();
      if (name) {
        try {
          broadcastToDesktop(sid, {
            type: 'command',
            cmd: name,
            args: [],
            from: { userId: donorId, username: donorName },
            amount,
            currency: 'KRW',
            at: Date.now(),
            source: 'youtube-super-chat-rule'
          });
        } catch { }
      }

      const tmpl = String(r.response || '').trim();
      const vars = { username: donorName, amount, message: donorMessage };
      let built = tmpl.replace(/\$\{\s*(username|amount|message)\s*\}/g, (_, k) => String(vars[k]));
      try { built = await substituteAllPlaceholders(built, sid, donorId, donorName); } catch { }
      const donationFeatures = [];
      const rlRe = /\$\{\s*roulette::([^}]+)\s*\}/i;
      const rlReAll = /\$\{\s*roulette::([^}]+)\s*\}/ig;
      if (rlRe.test(String(built || ''))) {
        try {
          const m = String(built).match(rlRe);
          const rouletteName = m && m[1] ? String(m[1]).trim() : '';
          built = String(built || '').replace(rlReAll, '').trim();
          if (rouletteName) {
            enqueueRouletteSpin(sid, {
              name: rouletteName,
              userId: donorId,
              username: donorName,
              chatPost: makeYoutubeChatPost(ownerUserId, entry.liveChatId, donorName),
              instant: false,
              eventContext: { source: 'youtube-super-chat-rule', triggerName: r.name || null }
            });
            donationFeatures.push('roulette');
          }
        } catch { }
      }
      await recordDonationRuleExecutionLog(sid, {
        provider: 'youtube',
        channelUid: entry.channelId || null,
        userId: donorId,
        username: donorName,
        ruleId: r.id || null,
        ruleName: r.name || null,
        targetName: donationFeatures.includes('roulette') ? '룰렛 실행' : '채팅 반응',
        amount,
        message: donorMessage,
        features: donationFeatures,
        source: 'youtube-super-chat-rule',
        summary: `후원 반응 실행: ${r.name || '이름 없음'} · ${amount.toLocaleString('ko-KR')}원`,
      });
      built = String(built || '').trim();
      if (built) responsesToSend.push(built);
    }

    for (const msgText of responsesToSend) {
      await sendYoutubeChat(ownerUserId, entry.liveChatId, msgText).catch(() => { });
      await new Promise(r => setTimeout(r, 120));
    }
  } catch (e) {
    console.error('[YouTube] Super Chat automation error', e?.message || e);
  }
}

async function processYoutubeChatAutomation(entry, ev) {
  try {
    const ownerUserId = entry.ownerUserId;
    const sid = entry.primarySid || `user:${ownerUserId}`;
    const text = String(ev.message || '').trim();
    if (!text) return;

    const settings = await getBotSettings(sid) || {};
    const liveState = await refreshYoutubeLiveStatus(ownerUserId, sid, { ttlMs: 30 * 1000 });
    if (settings.onlyWhenLive && !liveState.live) return;

    const resolvedUserId = String(ev.userId || ev.user || 'unknown_user');
    const resolvedUsername = String(ev.user || 'Unknown');
    const isOwner = ev.role?.owner === true || String(resolvedUserId) === String(entry.channelId || '');
    const isBotSelf = isLikelyYoutubeSelfEcho(entry, ev);

    if (liveState.live) {
      try {
        const attendDate = await getAttendanceDate(sid);
        const attKey = `${sid}:${resolvedUserId}:${attendDate}`;
        const excludedFromText = typeof settings.attendanceExcludeUserIdsText === 'string'
          ? settings.attendanceExcludeUserIdsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
          : [];
        const excluded = Array.isArray(settings.attendanceExcludeUserIds) ? settings.attendanceExcludeUserIds.map(String) : [];
        const excludedSet = new Set([...excluded, ...excludedFromText].map(String));
        if (!attendanceDedupe.has(attKey) && !isOwner && !isBotSelf && !excludedSet.has(resolvedUserId)) {
          const result = await recordAttendanceAndGetStreak(sid, resolvedUserId, resolvedUsername, attendDate);
          attendanceDedupe.add(attKey);
          if (result?.isNew && settings.attendanceAnnounce !== false) {
            let totalDays = 0;
            try { totalDays = await getUserAttendanceTotalDays(sid, resolvedUserId); } catch { }
            const attendanceBonus = Math.max(0, Number(settings.channelPointsPerAttendance || 0));
            const reply = renderAttendanceMessage(settings.attendanceMessage, {
              username: resolvedUsername,
              userId: resolvedUserId,
              streak: result.streak,
              totalDays,
              points: attendanceBonus,
              date: attendDate
            });
            await sendYoutubeChat(ownerUserId, entry.liveChatId, reply).catch(() => { });
          }
          const bonus = Math.max(0, Number(settings.channelPointsPerAttendance || 0));
          if (bonus > 0 && entry.channelId && !(await isChannelPointExcluded(settings, resolvedUserId))) {
            await incrChannelPoints(entry.channelId, resolvedUserId, resolvedUsername, bonus).catch(() => { });
          }
        }
      } catch { }

      try {
        const perChat = Math.max(0, Number(settings.channelPointsPerChat ?? 1));
        if (entry.channelId && perChat > 0 && !isOwner && !isBotSelf && !(await isChannelPointExcluded(settings, resolvedUserId))) {
          await incrChannelPoints(entry.channelId, resolvedUserId, resolvedUsername, perChat).catch(() => { });
        }
      } catch { }
    }

    if (isBotSelf || settings.botEnabled === false) return;
    try {
      const predictionReply = await handlePredictionBetCommand({
        sid,
        channelUid: entry.channelId,
        userId: resolvedUserId,
        username: resolvedUsername,
        provider: 'youtube',
        text,
      });
      if (predictionReply) {
        await sendYoutubeChat(ownerUserId, entry.liveChatId, predictionReply).catch(() => { });
        return;
      }
    } catch (e) {
      console.error('[Prediction] YouTube command error', e?.message || e);
    }

    const rules = await getBotRulesWithDefaults(sid);
    if (!Array.isArray(rules)) return;
    const lower = text.toLowerCase();
    const now = Date.now();
    const roleLevel = isOwner ? 4 : (ev.role?.moderator ? 3 : (ev.role?.sponsor ? 2 : 1));
    for (const r of rules) {
      if (!r || r.enabled === false) continue;
      const required = Number(r.requiredRoleLevel || (r.adminOnly ? 3 : 1));
      if (roleLevel < required) continue;
      const cooldown = Math.max(1000, Number(r.cooldown || 0));
      if (now - Number(r.lastUsed || 0) < cooldown) continue;
      if (r.liveOnly === true) {
        const live = await refreshYoutubeLiveStatus(ownerUserId, sid, { ttlMs: 30 * 1000 });
        if (!live.live) continue;
      }

      let matchedKeyword = null;
      const matched = (r.keywords || []).some((kw) => {
        if (!kw) return false;
        const ok = lower.startsWith(String(kw).toLowerCase());
        if (ok && matchedKeyword == null) matchedKeyword = String(kw);
        return ok;
      });
      if (!matched) continue;

      const responses = Array.isArray(r.responses) ? r.responses.filter(Boolean) : [];
      let response = responses[Math.floor(Math.random() * responses.length)] || '';
      let allowExecute = true;
      const commandCost = Math.max(0, Number(r.pointsCost || 0));
      const isRouletteRule = responses.some((s) => typeof s === 'string' && /\$\{\s*roulette::/i.test(s));
      let commandPointDelta = 0;
      let commandPointBefore = null;
      let commandPointAfter = null;
      const commandFeatures = [];
      const commandActionJobs = [];
      if (!isRouletteRule && commandCost > 0 && entry.channelId && resolvedUserId) {
        const have = await getChannelPoints(entry.channelId, resolvedUserId).catch(() => 0);
        if (Number(have || 0) < commandCost) {
          response = `포인트가 부족합니다. (${commandCost} 필요, ${Number(have || 0)} 보유 중)`;
          allowExecute = false;
        } else {
          await incrChannelPoints(entry.channelId, resolvedUserId, resolvedUsername, -commandCost).catch(() => { });
          commandPointDelta -= commandCost;
          commandPointBefore = Number(have || 0);
          commandPointAfter = Number(have || 0) - commandCost;
        }
      }

      try { response = await substituteAllPlaceholders(response, sid, resolvedUserId, resolvedUsername); } catch { }

      const cmd = matchedKeyword || '';
      const args = text.slice(cmd.length).trim().split(/\s+/).map(String).filter(Boolean);
      if (allowExecute && cmd) {
        const payload = {
          type: 'command',
          cmd,
          args,
          from: { userId: resolvedUserId, username: resolvedUsername },
          at: Date.now(),
          source: 'youtube-chat',
          executionContext: { source: 'youtube-chat', pointsDeducted: commandCost > 0, commandCost }
        };
        try { emitWarudoEvent(sid, payload); } catch { }
        try { broadcastToDesktop(sid, { ...payload, metadata: payload.executionContext }); } catch { }
      }

      let cleaned = String(response || '');
      const vdRe = /\$\{\s*video_donation\s*\}/i;
      const vdReAll = /\$\{\s*video_donation\s*\}/ig;
      if (allowExecute && vdRe.test(cleaned)) {
        try {
          cleaned = await enqueueVideoDonationFromArgs({
            sid,
            channelUid: entry.channelId,
            userId: resolvedUserId,
            username: resolvedUsername,
            args,
            response: cleaned,
            vdReAll,
            context: {
              source: 'youtube-chat-command',
              provider: 'youtube',
              command: { keyword: matchedKeyword || '', ruleId: r.id || null, ruleName: r.name || null },
            },
          });
          commandFeatures.push('video_donation');
        } catch {
          cleaned = '영상 요청 처리 중 오류가 발생했습니다.';
        }
      }

      const rlRe = /\$\{\s*roulette::([^}]+)\s*\}/i;
      const rlReAll = /\$\{\s*roulette::([^}]+)\s*\}/ig;
      if (allowExecute && rlRe.test(cleaned)) {
        try {
          const m = String(cleaned).match(rlRe);
          const name = m && m[1] ? String(m[1]).trim() : '';
          cleaned = String(cleaned).replace(rlReAll, '').trim();
          let count = 1;
          const n = parseInt(args[0] || '', 10);
          if (Number.isFinite(n)) count = Math.max(1, Math.min(10, n));
          if (name) {
            if (commandCost > 0 && entry.channelId && resolvedUserId) {
              const need = commandCost * count;
              const have = await getChannelPoints(entry.channelId, resolvedUserId).catch(() => 0);
              if (Number(have || 0) < need) {
                cleaned = `포인트가 부족합니다. (${need} 필요, ${Number(have || 0)} 보유 중)`;
                allowExecute = false;
              } else {
                await incrChannelPoints(entry.channelId, resolvedUserId, resolvedUsername, -need).catch(() => { });
                commandPointDelta -= need;
                commandPointBefore = Number(have || 0);
                commandPointAfter = Number(have || 0) - need;
              }
            }
          }
          if (name && allowExecute) {
            const base = {
              name,
              userId: resolvedUserId,
              username: resolvedUsername,
              chatPost: count > 1
                ? makeYoutubeChatPost(ownerUserId, entry.liveChatId, resolvedUsername, { suppressResultChat: true, batchId: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, batchCount: count })
                : makeYoutubeChatPost(ownerUserId, entry.liveChatId, resolvedUsername)
            };
            enqueueRouletteSpin(sid, {
              ...base,
              instant: false,
              eventContext: {
                source: 'youtube-chat-command',
                triggerName: matchedKeyword || '',
                pointDelta: commandPointDelta,
                pointBefore: commandPointBefore,
                pointAfter: commandPointAfter,
              },
            });
            for (let i = 1; i < count; i++) enqueueRouletteSpin(sid, { ...base, instant: true, eventContext: { source: 'youtube-chat-command', triggerName: matchedKeyword || '' } });
            cleaned = '';
            commandFeatures.push('roulette');
          }
        } catch {
          cleaned = '룰렛 실행 중 오류가 발생했습니다.';
        }
      }

      if (allowExecute) {
        const actionResult = await executeAndStripActionVariableTokens(sid, cleaned, {
          source: 'youtube-chat-command',
          platform: 'youtube',
          command: { keyword: matchedKeyword || '', text, ruleId: r.id || null, ruleName: r.name || null },
          user: { userId: resolvedUserId, username: resolvedUsername },
          chatPost: makeYoutubeChatPost(ownerUserId, entry.liveChatId, resolvedUsername),
          channelUid: entry.channelId || null,
          channel: { channelUid: entry.channelId || null },
        });
        if (actionResult.used) {
          cleaned = actionResult.text;
          commandFeatures.push('action');
          commandActionJobs.push(...(actionResult.jobs || []));
        }
      }

      cleaned = String(cleaned || '').trim();
      const replyKey = makeCommandReplyKey(ev, r, matchedKeyword || '', text, resolvedUserId);
      if (cleaned && !entry.sentReplies.has(replyKey)) {
        entry.sentReplies.add(replyKey);
        if (entry.sentReplies.size > 1000) {
          let i = 0; for (const key of entry.sentReplies) { entry.sentReplies.delete(key); if (++i >= 100) break; }
        }
        await sendYoutubeChat(ownerUserId, entry.liveChatId, cleaned).catch((e) => {
          console.error('[YouTube] Auto-reply send error', e?.response?.data || e.message);
        });
      }
      try { await upsertBotRule(sid, { ...r, lastUsed: now }); } catch { }
      await recordCommandExecutionLog(sid, {
        executed: allowExecute,
        provider: 'youtube',
        channelUid: entry.channelId || null,
        userId: resolvedUserId,
        username: resolvedUsername,
        triggerName: matchedKeyword || '',
        targetName: r.name || null,
        ruleId: r.id || null,
        ruleName: r.name || null,
        args,
        pointDelta: commandPointDelta,
        pointBefore: commandPointBefore,
        pointAfter: commandPointAfter,
        features: commandFeatures,
        actionJobs: commandActionJobs,
        source: 'youtube-chat',
        summary: `명령어 실행: ${matchedKeyword || ''}${r.name ? ` · ${r.name}` : ''}`,
      });
      break;
    }
  } catch (e) {
    console.error('[YouTube] Chat automation error', e?.message || e);
  }
}

function handleYoutubeParsedLiveChatEvent(entry, eventName, ev) {
  if (!entry || !eventName || !ev) return false;
  if (ev.ts && ev.ts < Number(entry.acceptAfterTs || 0)) return false;
  const dedupeKey = `${eventName}:${ev.id || ev.ts || ''}`;
  if (entry.processedIds.has(dedupeKey)) return false;
  entry.processedIds.add(dedupeKey);
  if (entry.processedIds.size > 5000) {
    let i = 0; for (const key of entry.processedIds) { entry.processedIds.delete(key); if (++i >= 500) break; }
  }
  pushEvent(entry, ev);
  if (eventName === 'CHAT') {
    processYoutubeChatAutomation(entry, ev).catch(() => { });
  } else if (eventName === 'DONATION') {
    processYoutubeDonationAutomation(entry, ev).catch(() => { });
  }
  return true;
}

function handleYoutubeChatLibraryItem(entry, chatItem) {
  entry.lastMessageAt = Date.now();
  const parsed = normalizeYoutubeChatLibraryItem(chatItem);
  if (!parsed) return;
  handleYoutubeParsedLiveChatEvent(entry, parsed.eventName, parsed.ev);
}

function handleYoutubeLiveChatResponse(entry, payload) {
  if (!payload || typeof payload !== 'object') return;
  if (payload.nextPageToken) entry.nextPageToken = payload.nextPageToken;
  entry.lastMessageAt = Date.now();
  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items) {
    const parsed = normalizeYoutubeLiveChatItem(item);
    if (!parsed) continue;
    handleYoutubeParsedLiveChatEvent(entry, parsed.eventName, parsed.ev);
  }
  if (payload.offlineAt) closeYoutubeSession(entry.ownerUserId, 'offline');
}

function scheduleYoutubeReconnect(ownerUserId, delayMs = null) {
  const entry = youtubeSessionStore.get(ownerUserId);
  if (!entry || entry.closed) return;
  if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
  const attempts = Number(entry.reconnectAttempts || 0) + 1;
  entry.reconnectAttempts = attempts;
  const delay = delayMs ?? Math.min(60 * 1000, 1000 * Math.pow(2, Math.min(6, attempts - 1)));
  entry.reconnectTimer = setTimeout(() => {
    youtubeSessionStore.delete(ownerUserId);
    ensureYoutubeSession(ownerUserId).catch((e) => {
      console.warn('[YouTube] Reconnect failed:', e?.response?.data || e?.message || e);
    });
  }, delay);
}

function getYoutubeReconnectDelayForError(error) {
  const status = Number(error?.response?.status || error?.status || error?.lastStatus || 0);
  if (status === 401) return null;
  if (status === 403) return 5 * 60 * 1000;
  if (status === 429) return 60 * 1000;
  return undefined;
}

function closeYoutubeSession(ownerUserId, reason = 'closed') {
  const entry = youtubeSessionStore.get(ownerUserId);
  if (!entry) return false;
  entry.closed = true;
  entry.connected = false;
  entry.closeReason = reason;
  if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
  try { entry.chatClient?.stop?.(reason); } catch { }
  try { entry.abortController?.abort(); } catch { }
  try { entry.stream?.destroy?.(); } catch { }
  youtubeSessionStore.delete(ownerUserId);
  return true;
}

async function openYoutubeChatStream(entry) {
  if (typeof YoutubeLiveChat !== 'function') throw new Error('youtube-chat LiveChat is not available');
  const youtubeId = entry.channelId
    ? { channelId: String(entry.channelId) }
    : entry.broadcastId
      ? { liveId: String(entry.broadcastId) }
      : null;
  if (!youtubeId) throw new Error('No YouTube channelId or liveId for youtube-chat');

  const intervalMs = Math.max(1000, Number.isFinite(YOUTUBE_CHAT_FETCH_INTERVAL_MS) ? YOUTUBE_CHAT_FETCH_INTERVAL_MS : 1000);
  const liveChat = new YoutubeLiveChat(youtubeId, intervalMs);
  entry.chatClient = liveChat;
  entry.stream = null;

  liveChat.on('start', (liveId) => {
    entry.connected = true;
    entry.broadcastId = liveId || entry.broadcastId || null;
    entry.lastError = null;
    entry.lastStatus = null;
    entry.reconnectAttempts = 0;
  });
  liveChat.on('chat', (chatItem) => {
    try { handleYoutubeChatLibraryItem(entry, chatItem); } catch (e) {
      console.warn('[YouTube] Failed to handle youtube-chat item:', e?.message || e);
    }
  });
  liveChat.on('error', (err) => {
    entry.connected = false;
    entry.lastError = err?.response?.data?.error?.message || err?.message || String(err || 'youtube_chat_error');
    entry.lastStatus = err?.status || err?.response?.status || null;
    if (!entry.closed) {
      try { liveChat.stop('error'); } catch { }
    }
  });
  liveChat.on('end', (reason) => {
    entry.connected = false;
    entry.stream = null;
    if (!entry.closed) scheduleYoutubeReconnect(entry.ownerUserId, reason === 'error' ? getYoutubeReconnectDelayForError(entry) : undefined);
  });

  const ok = await liveChat.start();
  if (!ok) {
    entry.connected = false;
    throw new Error(entry.lastError || 'youtube-chat start failed');
  }
}

async function ensureYoutubeSession(ownerUserId) {
  if (!ownerUserId) throw new Error('ownerUserId is required');
  const existing = youtubeSessionStore.get(ownerUserId);
  if (existing && !existing.closed && (existing.connected || existing.stream || existing.chatClient)) return existing;
  if (youtubeSessionCreatePromises.has(ownerUserId)) return youtubeSessionCreatePromises.get(ownerUserId);

  const createPromise = (async () => {
    const sid = `user:${ownerUserId}`;
    const botProfile = await getValidYoutubeBotProfile();
    const streamerChannel = await getYoutubeStreamerChannel(ownerUserId);
    if (!streamerChannel?.youtubeChannelId) {
      const entry = {
        provider: 'youtube',
        ownerUserId,
        primarySid: sid,
        channelId: null,
        botChannelId: botProfile.selectedChannelId,
        liveChatId: null,
        broadcastId: null,
        queue: [],
        connected: false,
        processedIds: new Set(),
        sentReplies: new Set(),
        recentOutboundMessages: new Map(),
        nextPageToken: null,
        abortController: null,
        chatClient: null,
        stream: null,
        reconnectTimer: null,
        reconnectAttempts: 0,
        lastMessageAt: null,
        lastError: 'youtube_streamer_channel_not_registered',
        lastStatus: 409,
        acceptAfterTs: Date.now() - 2000,
        closed: false
      };
      youtubeSessionStore.set(ownerUserId, entry);
      return entry;
    }
    if (streamerChannel.moderatorRegistered !== true) {
      const entry = {
        provider: 'youtube',
        ownerUserId,
        primarySid: sid,
        channelId: streamerChannel.youtubeChannelId,
        botChannelId: botProfile.selectedChannelId,
        liveChatId: null,
        broadcastId: null,
        queue: [],
        connected: false,
        processedIds: new Set(),
        sentReplies: new Set(),
        recentOutboundMessages: new Map(),
        nextPageToken: null,
        abortController: null,
        chatClient: null,
        stream: null,
        reconnectTimer: null,
        reconnectAttempts: 0,
        lastMessageAt: null,
        lastError: 'youtube_bot_moderator_not_confirmed',
        lastStatus: 409,
        acceptAfterTs: Date.now() - 2000,
        closed: false
      };
      youtubeSessionStore.set(ownerUserId, entry);
      return entry;
    }
    const liveState = await refreshYoutubeLiveStatus(ownerUserId, sid, { force: true });
    const channelId = liveState.channelId || await getYoutubeChannelId(ownerUserId);
    const entry = {
      provider: 'youtube',
      ownerUserId,
      primarySid: sid,
      channelId,
      botChannelId: botProfile.selectedChannelId,
      liveChatId: liveState.liveChatId || null,
      broadcastId: liveState.broadcastId || null,
      queue: [],
      connected: false,
      processedIds: new Set(),
      sentReplies: new Set(),
      recentOutboundMessages: new Map(),
      nextPageToken: null,
      abortController: null,
      chatClient: null,
      stream: null,
      reconnectTimer: null,
      reconnectAttempts: 0,
      lastMessageAt: null,
      lastError: null,
      lastStatus: null,
      acceptAfterTs: Date.now() - 2000,
      closed: false
    };
    youtubeSessionStore.set(ownerUserId, entry);
    if (!liveState.live || !liveState.liveChatId) {
      entry.lastError = liveState.live ? 'live_chat_unavailable' : 'not_live';
      return entry;
    }
    try {
      await openYoutubeChatStream(entry);
    } catch (e) {
      entry.connected = false;
      entry.lastError = e?.response?.data?.error?.message || e?.message || 'stream_connect_failed';
      entry.lastStatus = e?.status || e?.response?.status || null;
      const reconnectDelay = getYoutubeReconnectDelayForError(e);
      if (reconnectDelay !== null) scheduleYoutubeReconnect(ownerUserId, reconnectDelay);
    }
    return entry;
  })();

  youtubeSessionCreatePromises.set(ownerUserId, createPromise);
  try {
    return await createPromise;
  } finally {
    youtubeSessionCreatePromises.delete(ownerUserId);
  }
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function extractCimeUserFields(data = {}, fallbackName = 'Unknown') {
  const profile = data.profile || data.senderProfile || data.userProfile || data.user || data.sender || {};
  const channel = data.channel || profile.channel || {};
  const userId = firstNonEmptyText(
    data.senderChannelId,
    data.senderChannelID,
    data.senderUserId,
    data.senderId,
    data.userId,
    data.userID,
    data.memberId,
    data.memberChannelId,
    data.channelId,
    data.channelID,
    profile.userId,
    profile.userID,
    profile.channelId,
    profile.channelID,
    profile.id,
    channel.channelId,
    channel.id
  );
  const username = firstNonEmptyText(
    data.senderNickname,
    data.senderName,
    data.nickname,
    data.displayName,
    data.name,
    profile.nickname,
    profile.displayName,
    profile.name,
    channel.channelName,
    fallbackName
  );
  return { userId, username };
}

function parseCimeEvent(raw) {
  if (!raw) return null;
  const msg = typeof raw === 'string'
    ? (() => { try { return JSON.parse(raw); } catch { return null; } })()
    : raw;
  if (!msg || msg.action === 'PONG' || msg.type === 'PONG') return null;
  const eventName = String(msg.event || msg.type || '').toUpperCase();
  const data = msg.data || msg.content || msg;
  if (!eventName || !data) return null;

  if (eventName === 'CHAT') {
    const tsCandidate = data.messageTime || data.createdAt || data.publishedAt || data.timestamp || data.time || null;
    const ts = tsCandidate ? parseLiveTimestamp(tsCandidate, Date.now()) : Date.now();
    const { userId, username } = extractCimeUserFields(data);
    const message = firstNonEmptyText(data.content, data.message, data.text, data.chatMessage, data.body);
    const messageId = data.messageId || data.messageID || data.id || data.eventId || `${userId || username || 'chat'}:${ts}:${String(message || '').slice(0, 80)}`;
    return {
      eventName,
      data,
      ev: {
        type: 'chat',
        id: String(messageId),
        ts: Number.isFinite(ts) ? ts : Date.now(),
        user: username || 'Unknown',
        userId,
        message,
        raw: data,
        provider: 'cime'
      }
    };
  }

  if (eventName === 'DONATION') {
    const ts = Date.now();
    const donorId = firstNonEmptyText(data.donatorChannelId, data.donatorUserId, data.donatorId, data.senderChannelId, data.userId, data.profile?.userId, data.profile?.channelId);
    const donorName = firstNonEmptyText(data.donatorNickname, data.donatorName, data.senderNickname, data.nickname, data.profile?.nickname, 'Unknown');
    return {
      eventName,
      data,
      ev: {
        type: 'donation',
        id: `${donorId || donorName || 'donation'}:${ts}`,
        ts,
        user: donorName || 'Unknown',
        userId: donorId,
        amount: Number(data.payAmount || 0),
        message: data.donationText || '',
        raw: data,
        provider: 'cime',
        donationType: data.donationType || null
      }
    };
  }

  if (eventName === 'SUBSCRIPTION') {
    const ts = Date.now();
    const subscriberId = firstNonEmptyText(data.subscriberChannelId, data.subscriberUserId, data.subscriberId, data.senderChannelId, data.userId, data.profile?.userId, data.profile?.channelId);
    const subscriberName = firstNonEmptyText(data.subscriberChannelName, data.subscriberNickname, data.subscriberName, data.senderNickname, data.nickname, data.profile?.nickname, 'Unknown');
    return {
      eventName,
      data,
      ev: {
        type: 'subscription',
        id: `${subscriberId || subscriberName || 'subscription'}:${ts}`,
        ts,
        user: subscriberName || 'Unknown',
        userId: subscriberId,
        months: Number(data.month || 0),
        message: data.subscriptionText || data.tierName || '',
        raw: data,
        provider: 'cime'
      }
    };
  }

  return null;
}

function rememberCimeSubscriptionMonths(entry, ev) {
  const sid = entry?.primarySid || (entry?.ownerUserId ? `user:${entry.ownerUserId}` : '');
  const userId = String(ev?.userId || '').trim();
  const months = readFiniteNumber(ev?.months, ev?.raw?.month, ev?.raw?.months, ev?.raw?.subscriptionMonths);
  if (!sid || !userId || months == null) return;
  userSubMonthsCache.set(`${sid}:${userId}`, { ts: Date.now(), months });
}

async function getCimeChannelId(ownerUserId) {
  const accountChannelId = await resolveChannelIdForOwnerUserId(ownerUserId, { provider: 'cime', allowFallback: false });
  if (accountChannelId) return accountChannelId;
  const tokens = await getPlatformTokens('cime', ownerUserId);
  if (tokens?.platformUserId) return String(tokens.platformUserId);
  return null;
}

async function isLikelyCimeBotSelfEcho(entry, ownerUserId, ev, resolvedUserId) {
  const userId = String(resolvedUserId || ev?.userId || '').trim();
  if (!userId) return false;
  const text = String(ev?.message || '').trim();
  const selfIds = new Set();
  if (entry?.channelId) selfIds.add(String(entry.channelId));
  const tokenChannelId = await getCimeChannelId(ownerUserId).catch(() => null);
  if (tokenChannelId) selfIds.add(String(tokenChannelId));
  return hasRecentOutboundMessage(entry, text) && selfIds.has(userId);
}

async function sendCimeChat(ownerUserId, message) {
  const text = String(message || '').trim();
  if (!text) return null;
  const accessToken = await getValidCimeAccessToken(ownerUserId);
  const r = await axios.post(`${CIME_OPENAPI_BASE}/open/v1/chats/send`, {
    message: text.slice(0, 100),
    senderType: 'APP'
  }, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  });
  rememberOutboundMessage(cimeSessionStore.get(ownerUserId), text.slice(0, 100));
  return unwrapOpenApiContent(r);
}

async function refreshCimeLiveStatus(ownerUserId, sid, channelId) {
  try {
    const cached = liveStatusCache.get(sid);
    const now = Date.now();
    if (cached && cached.provider === 'cime' && (now - cached.ts) < 60 * 1000) return !!cached.live;
    const cid = channelId || await getCimeChannelId(ownerUserId);
    if (!cid) return false;
    const r = await axios.get(`${CIME_OPENAPI_BASE}/v1/${encodeURIComponent(cid)}/live-status`);
    const content = unwrapOpenApiContent(r);
    const status = String(content?.status || content?.liveStatus || content?.state || '').toLowerCase();
    const live = isCimeLiveContentOpen(content);
    const startedCandidate = content?.startedAt || content?.started_at || content?.openDate || content?.openTime || content?.openedAt || content?.liveStartAt || content?.startTime || content?.createdAt || null;
    const existingStart = cached?.provider === 'cime' ? Number(cached.startTs || 0) || null : null;
    const sessionStart = Number(liveSession.get(sid)?.sessionStartTime || 0) || null;
    const startTs = live ? parseLiveTimestamp(startedCandidate, existingStart || sessionStart || now) : null;
    liveStatusCache.set(sid, { ts: now, live, provider: 'cime', channelId: cid, startTs });
    if (live && !liveSession.get(sid)?.live) {
      const today = getKstDateString(startTs || now);
      liveSession.set(sid, { live: true, startDate: today, sessionStartTime: startTs || now, lastUpdate: now });
      try {
        await upsertLiveSessionToDB({
          sid,
          live: true,
          start_date: today,
          session_start_time: startTs || now,
          last_update: now
        });
      } catch { }
    } else if (!live && liveSession.get(sid)?.live) {
      try { await updateSessionState(sid, false, now); } catch { }
    }
    return live;
  } catch {
    return false;
  }
}

async function isCimeLiveAllowed(ownerUserId, sid, channelId) {
  const settings = await getBotSettings(sid) || {};
  const live = await refreshCimeLiveStatus(ownerUserId, sid, channelId);
  return !settings.onlyWhenLive || live;
}

async function enqueueVideoDonationFromArgs({ sid, channelUid, userId, username, args, response, vdReAll, context = {} }) {
  const firstArg = Array.isArray(args) ? (args[0] || '') : '';
  const startArgRaw = Array.isArray(args) ? args[1] : undefined;
  const playArgRaw = Array.isArray(args) ? args[2] : undefined;
  const looksLikeUrl = /^https?:\/\//i.test(firstArg) || /youtu/i.test(firstArg) || /tiktok/i.test(firstArg) || /chzzk/i.test(firstArg) || /ci\.me/i.test(firstArg) || /^[A-Za-z0-9_-]{11}$/.test(firstArg);
  const urlArg = looksLikeUrl ? firstArg : (Array.isArray(args) ? args.join(' ') : firstArg);
  const cleaned = String(response || '').replace(vdReAll, '').trim();
  if (!urlArg) return cleaned || '링크를 입력해 주세요.';

  const settings = await getBotSettings(sid) || {};
  if (settings.videoDonationAcceptEnabled !== true) return cleaned || '지금은 영상 요청을 받을 수 없습니다.';

  const pps = Math.max(0, Number(settings.videoDonationPointsPerSecond ?? 1));
  const maxDur = Math.max(1, Number(settings.videoDonationMaxDurationSec ?? 600));
  const inputArg = String(urlArg || '').trim();
  let media;
  try {
    media = await resolvePvdMedia(inputArg, settings, { allowSearch: true });
  } catch (e) {
    if (e?.code === 'provider_disabled') return cleaned || `${getPvdProviderLabel(e.provider)} 요청은 꺼져 있습니다.`;
    if (e?.code === 'clip_playback_unavailable') {
      logChzzkClipPlaybackFailure('chat-command', e);
      return cleaned || '치지직 클립 mp4를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
    return cleaned || '올바른 링크나 검색어를 입력해 주세요.';
  }

  const startNum = Number(startArgRaw);
  const playNum = Number(playArgRaw);
  const start = Math.max(0, Number.isFinite(startNum) ? startNum : 0);
  const play = Number.isFinite(playNum) && playNum > 0 ? Math.floor(playNum) : null;

  const dur = getPvdPlayDurationSec({ maxDurationSec: maxDur, ytDurationSec: media.durationSec, startSec: start, playSec: play });
  const awaitDurationSync = shouldAwaitPvdDurationSync(media.provider, media.durationSec, play);
  const cost = Math.ceil(pps * dur);
  if (!channelUid) {
    const s = await getBotSettings(sid) || {};
    const uids = await resolveChzzkChannelUidsForSid(sid, s);
    if (uids.length) channelUid = uids[0];
  }
  if (!channelUid) return cleaned || '채널 ID를 확인할 수 없습니다.';
  const blocked = findBlockedBotUser(settings, userId, providerFromLogContext(context), [context.user?.platformUserId, context.user?.rawUserId]);
  if (blocked) return cleaned || '이 방송에서는 봇 기능을 사용할 수 없습니다.';
  const have = await getChannelPoints(channelUid, String(userId)).catch(() => 0);
  if (Number(have || 0) < cost) return `포인트가 부족합니다. 필요: ${cost}, 보유: ${Number(have || 0)}`;

  await incrChannelPoints(channelUid, String(userId), String(username || ''), -cost);
  const q = getVideoQueue(sid);
  const shouldStartPlayback = q.length === 0;
  const queueItem = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    mediaProvider: media.provider,
    mediaId: media.mediaId,
    mediaUrl: media.mediaUrl,
    embedUrl: media.embedUrl,
    thumbnailUrl: media.thumbnailUrl || null,
    videoId: media.provider === 'youtube' ? media.mediaId : null,
    title: media.title,
    durationSec: dur,
    mediaDurationSec: Number.isFinite(Number(media.durationSec)) ? Math.ceil(Number(media.durationSec)) : null,
    awaitDurationSync,
    startSec: start,
    requestedPlaySec: play,
    maxDurationSec: maxDur,
    cost,
    userId: String(userId),
    username: String(username || ''),
    status: 'queued'
  };
  q.push(queueItem);
  await recordBotEventLogSafe(sid, {
    category: 'video_donation',
    eventType: 'video_donation_request',
    provider: providerFromLogContext(context),
    channelUid,
    viewerUserId: String(userId),
    viewerName: String(username || ''),
    pointDelta: -cost,
    pointBefore: Number(have || 0),
    pointAfter: Number(have || 0) - cost,
    triggerName: context.command?.keyword || context.triggerName || null,
    targetName: media.title || media.mediaId || media.mediaUrl || '영상 후원',
    summary: `영상 후원 신청: ${media.title || media.mediaId || media.mediaUrl || '영상'} (${cost}P 사용)`,
    metadata: {
      mediaProvider: media.provider,
      mediaId: media.mediaId,
      mediaUrl: media.mediaUrl,
      embedUrl: media.embedUrl,
      thumbnailUrl: media.thumbnailUrl || null,
      title: media.title || null,
      durationSec: dur,
      mediaDurationSec: Number.isFinite(Number(media.durationSec)) ? Math.ceil(Number(media.durationSec)) : null,
      awaitDurationSync,
      startSec: start,
      requestedPlaySec: play,
      maxDurationSec: maxDur,
      cost,
      queueItemId: queueItem.id,
      source: context.source || null,
      command: context.command || null,
      replaySnapshot: queueItem,
    },
  });
  if (shouldStartPlayback) {
    await broadcastPvdStart(sid);
  } else {
    notifyPvdAdminSubscribers(sid, 'queued').catch(() => null);
  }
  const title = media.title ? (media.title.length > 20 ? media.title.slice(0, 20) + '...' : media.title) : null;
  const baseMsg = title ? `요청을 접수했습니다. ${title}` : '요청을 접수했습니다.';
  return cleaned ? `${cleaned} ${baseMsg}`.trim() : baseMsg;
}

async function processCimeChatAutomation(entry, ev) {
  try {
    const ownerUserId = entry.ownerUserId;
    const sid = entry.primarySid || `user:${ownerUserId}`;
    const text = String(ev.message || '').trim();
    if (!text) return;

    const settings = await getBotSettings(sid) || {};
    const currentlyLive = await refreshCimeLiveStatus(ownerUserId, sid, entry.channelId);
    if (settings.onlyWhenLive && !currentlyLive) return;
    const resolvedUsername = String(ev.user || 'Unknown');
    let resolvedUserId = String(ev.userId || '').trim();
    if (!resolvedUserId && resolvedUsername && resolvedUsername !== 'Unknown') {
      resolvedUserId = `cime:nickname:${crypto.createHash('sha256').update(resolvedUsername).digest('hex').slice(0, 16)}`;
    }
    if (!resolvedUserId) resolvedUserId = 'unknown_user';
    const pointChannelUid = entry.channelId || await resolveStreamerUidForSid(sid);
    if (pointChannelUid && !entry.channelId) entry.channelId = pointChannelUid;
    const isOwner = entry.channelId && String(resolvedUserId) === String(entry.channelId);
    const isBotSelf = await isLikelyCimeBotSelfEcho(entry, ownerUserId, ev, resolvedUserId).catch(() => false);
    if (isBotSelf) return;

    if (currentlyLive) {
      try {
        const attendDate = await getAttendanceDate(sid);
        const attKey = `${sid}:${resolvedUserId}:${attendDate}`;
        const excludedFromText = typeof settings.attendanceExcludeUserIdsText === 'string'
          ? settings.attendanceExcludeUserIdsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
          : [];
        const excluded = Array.isArray(settings.attendanceExcludeUserIds) ? settings.attendanceExcludeUserIds.map(String) : [];
        const excludedSet = new Set([...excluded, ...excludedFromText].map(String));
        if (!attendanceDedupe.has(attKey) && !isOwner && !excludedSet.has(resolvedUserId)) {
          const result = await recordAttendanceAndGetStreak(sid, resolvedUserId, resolvedUsername, attendDate);
          attendanceDedupe.add(attKey);
          if (result?.isNew && settings.attendanceAnnounce !== false) {
            let totalDays = 0;
            try { totalDays = await getUserAttendanceTotalDays(sid, resolvedUserId); } catch { }
            const attendanceBonus = Math.max(0, Number(settings.channelPointsPerAttendance || 0));
            const text = renderAttendanceMessage(settings.attendanceMessage, {
              username: resolvedUsername,
              userId: resolvedUserId,
              streak: result.streak,
              totalDays,
              points: attendanceBonus,
              date: attendDate
            });
            await sendCimeChat(ownerUserId, text).catch(() => { });
          }
          const bonus = Math.max(0, Number(settings.channelPointsPerAttendance || 0));
          if (bonus > 0 && pointChannelUid && !(await isChannelPointExcluded(settings, resolvedUserId))) {
            await incrChannelPoints(pointChannelUid, resolvedUserId, resolvedUsername, bonus).catch((error) => {
              console.warn('[CIME] Attendance point award failed:', error?.message || error);
            });
          }
        }
      } catch { }

      try {
        const perChat = Math.max(0, Number(settings.channelPointsPerChat ?? 1));
        if (pointChannelUid && perChat > 0 && !isOwner && !(await isChannelPointExcluded(settings, resolvedUserId))) {
          await incrChannelPoints(pointChannelUid, resolvedUserId, resolvedUsername, perChat).catch((error) => {
            console.warn('[CIME] Chat point award failed:', error?.message || error);
          });
        }
      } catch { }
    }

    if (settings.botEnabled === false) return;
    try {
      const predictionReply = await handlePredictionBetCommand({
        sid,
        channelUid: pointChannelUid || entry.channelId,
        userId: resolvedUserId,
        username: resolvedUsername,
        provider: 'cime',
        text,
      });
      if (predictionReply) {
        await sendCimeChat(ownerUserId, predictionReply).catch(() => { });
        return;
      }
    } catch (e) {
      console.error('[Prediction] CIME command error', e?.message || e);
    }

    const rules = await getBotRulesWithDefaults(sid);
    if (!Array.isArray(rules)) return;

    const lower = text.toLowerCase();
    const now = Date.now();
    const roleLevel = isOwner ? 4 : 1;
    for (const r of rules) {
      if (!r || r.enabled === false) continue;
      const required = Number(r.requiredRoleLevel || (r.adminOnly ? 3 : 1));
      if (roleLevel < required) continue;
      const cooldown = Math.max(1000, Number(r.cooldown || 0));
      if (now - Number(r.lastUsed || 0) < cooldown) continue;
      if (r.liveOnly === true) {
        const live = await isCimeLiveAllowed(ownerUserId, sid, entry.channelId);
        if (!live) continue;
      }

      let matchedKeyword = null;
      const matched = (r.keywords || []).some((kw) => {
        if (!kw) return false;
        const ok = lower.startsWith(String(kw).toLowerCase());
        if (ok && matchedKeyword == null) matchedKeyword = String(kw);
        return ok;
      });
      if (!matched) continue;

      const responses = Array.isArray(r.responses) ? r.responses.filter(Boolean) : [];
      let response = responses[Math.floor(Math.random() * responses.length)] || '';
      let allowExecute = true;
      const commandCost = Math.max(0, Number(r.pointsCost || 0));
      const isRouletteRule = responses.some((s) => typeof s === 'string' && /\$\{\s*roulette::/i.test(s));
      let commandPointDelta = 0;
      let commandPointBefore = null;
      let commandPointAfter = null;
      const commandFeatures = [];
      const commandActionJobs = [];
      if (!isRouletteRule && commandCost > 0 && pointChannelUid && resolvedUserId) {
        const have = await getChannelPoints(pointChannelUid, resolvedUserId).catch(() => 0);
        if (Number(have || 0) < commandCost) {
          response = `포인트가 부족합니다. (${commandCost} 필요, ${Number(have || 0)} 보유 중)`;
          allowExecute = false;
        } else {
          await incrChannelPoints(pointChannelUid, resolvedUserId, resolvedUsername, -commandCost).catch(() => { });
          commandPointDelta -= commandCost;
          commandPointBefore = Number(have || 0);
          commandPointAfter = Number(have || 0) - commandCost;
        }
      }

      try { response = await substituteAllPlaceholders(response, sid, resolvedUserId, resolvedUsername); } catch { }

      const cmd = matchedKeyword || '';
      const args = text.slice(cmd.length).trim().split(/\s+/).map(String).filter(Boolean);
      if (allowExecute && cmd) {
        const payload = {
          type: 'command',
          cmd,
          args,
          from: { userId: resolvedUserId, username: resolvedUsername },
          at: Date.now(),
          source: 'cime-chat',
          executionContext: { source: 'cime-chat', pointsDeducted: commandCost > 0, commandCost }
        };
        try { emitWarudoEvent(sid, payload); } catch { }
        try { broadcastToDesktop(sid, { ...payload, metadata: payload.executionContext }); } catch { }
      }

      let cleaned = String(response || '');
      const vdRe = /\$\{\s*video_donation\s*\}/i;
      const vdReAll = /\$\{\s*video_donation\s*\}/ig;
      if (allowExecute && vdRe.test(cleaned)) {
        try {
          cleaned = await enqueueVideoDonationFromArgs({
            sid,
            channelUid: pointChannelUid || entry.channelId,
            userId: resolvedUserId,
            username: resolvedUsername,
            args,
            response: cleaned,
            vdReAll,
            context: {
              source: 'cime-chat-command',
              provider: 'cime',
              command: { keyword: matchedKeyword || '', ruleId: r.id || null, ruleName: r.name || null },
            },
          });
          commandFeatures.push('video_donation');
        } catch (e) {
          cleaned = '영상 요청 처리 중 오류가 발생했습니다.';
        }
      }

      const rlRe = /\$\{\s*roulette::([^}]+)\s*\}/i;
      const rlReAll = /\$\{\s*roulette::([^}]+)\s*\}/ig;
      if (allowExecute && rlRe.test(cleaned)) {
        try {
          const m = String(cleaned).match(rlRe);
          const name = m && m[1] ? String(m[1]).trim() : '';
          cleaned = String(cleaned).replace(rlReAll, '').trim();
          let count = 1;
          const n = parseInt(args[0] || '', 10);
          if (Number.isFinite(n)) count = Math.max(1, Math.min(10, n));
          if (name) {
            if (commandCost > 0 && pointChannelUid && resolvedUserId) {
              const need = commandCost * count;
              const have = await getChannelPoints(pointChannelUid, resolvedUserId).catch(() => 0);
              if (Number(have || 0) < need) {
                cleaned = `포인트가 부족합니다. (${need} 필요, ${Number(have || 0)} 보유 중)`;
                allowExecute = false;
              } else {
                await incrChannelPoints(pointChannelUid, resolvedUserId, resolvedUsername, -need).catch(() => { });
                commandPointDelta -= need;
                commandPointBefore = Number(have || 0);
                commandPointAfter = Number(have || 0) - need;
              }
            }
          }
          if (name && allowExecute) {
            const base = {
              name,
              userId: resolvedUserId,
              username: resolvedUsername,
              chatPost: count > 1
                ? makeCimeChatPost(ownerUserId, resolvedUsername, { suppressResultChat: true, batchId: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, batchCount: count })
                : makeCimeChatPost(ownerUserId, resolvedUsername)
            };
            enqueueRouletteSpin(sid, {
              ...base,
              instant: false,
              eventContext: {
                source: 'cime-chat-command',
                triggerName: matchedKeyword || '',
                pointDelta: commandPointDelta,
                pointBefore: commandPointBefore,
                pointAfter: commandPointAfter,
              },
            });
            for (let i = 1; i < count; i++) enqueueRouletteSpin(sid, { ...base, instant: true, eventContext: { source: 'cime-chat-command', triggerName: matchedKeyword || '' } });
            cleaned = '';
            commandFeatures.push('roulette');
          }
        } catch (e) {
          cleaned = '룰렛 실행 중 오류가 발생했습니다.';
        }
      }
      if (allowExecute) {
        const actionResult = await executeAndStripActionVariableTokens(sid, cleaned, {
          source: 'cime-chat-command',
          platform: 'cime',
          command: { keyword: matchedKeyword || '', text, ruleId: r.id || null, ruleName: r.name || null },
          user: { userId: resolvedUserId, username: resolvedUsername },
          chatPost: makeCimeChatPost(ownerUserId, resolvedUsername),
          channelUid: pointChannelUid || entry.channelId || null,
          channel: { channelUid: pointChannelUid || entry.channelId || null },
        });
        if (actionResult.used) {
          cleaned = actionResult.text;
          commandFeatures.push('action');
          commandActionJobs.push(...(actionResult.jobs || []));
        }
      }
      cleaned = String(cleaned || '').trim();
      const replyKey = makeCommandReplyKey(ev, r, matchedKeyword || '', text, resolvedUserId);
      if (cleaned && !entry.sentReplies.has(replyKey)) {
        entry.sentReplies.add(replyKey);
        if (entry.sentReplies.size > 1000) {
          let i = 0; for (const key of entry.sentReplies) { entry.sentReplies.delete(key); if (++i >= 100) break; }
        }
        await sendCimeChat(ownerUserId, cleaned).catch((e) => {
          console.error('[CIME] Auto-reply send error', e?.response?.data || e.message);
        });
      }
      try { await upsertBotRule(sid, { ...r, lastUsed: now }); } catch { }
      await recordCommandExecutionLog(sid, {
        executed: allowExecute,
        provider: 'cime',
        channelUid: pointChannelUid || entry.channelId || null,
        userId: resolvedUserId,
        username: resolvedUsername,
        triggerName: matchedKeyword || '',
        targetName: r.name || null,
        ruleId: r.id || null,
        ruleName: r.name || null,
        args,
        pointDelta: commandPointDelta,
        pointBefore: commandPointBefore,
        pointAfter: commandPointAfter,
        features: commandFeatures,
        actionJobs: commandActionJobs,
        source: 'cime-chat',
        summary: `명령어 실행: ${matchedKeyword || ''}${r.name ? ` · ${r.name}` : ''}`,
      });
      break;
    }
  } catch (e) {
    console.error('[CIME] Chat automation error', e?.message || e);
  }
}

async function processCimeDonationAutomation(entry, ev) {
  try {
    const ownerUserId = entry.ownerUserId;
    const sid = entry.primarySid || `user:${ownerUserId}`;
    const settings = await getBotSettings(sid) || {};
    const amount = Math.max(0, Number(ev.amount || 0));
    const donorName = String(ev.user || 'Unknown');
    const donorId = String(ev.userId || `donor:${donorName}`);
    const donorMessage = String(ev.message || '');

    const pointsPerK = Math.max(0, Number(settings?.donation?.pointsPerK ?? 10));
    const award = Math.floor((amount / 1000) * pointsPerK);
    if (award > 0 && entry.channelId && !(await isChannelPointExcluded(settings, donorId))) {
      await incrChannelPoints(entry.channelId, donorId, donorName, award).catch(() => { });
    }

    const responsesToSend = [];
    const rules = Array.isArray(settings.donationRules) ? settings.donationRules : [];
    const lowerMsg = donorMessage.toLowerCase();
    for (const r of rules) {
      if (!r || r.enabled === false) continue;
      if (!donationRuleMatchesAmount(r, amount)) continue;
      const pat = String(r.message || '').trim();
      if (pat) {
        const needle = pat.toLowerCase();
        const passed = r.wildcard ? lowerMsg.includes(needle) : lowerMsg.startsWith(needle);
        if (!passed) continue;
      }

      const name = String(r.name || '').trim();
      if (name) {
        try {
          broadcastToDesktop(sid, {
            type: 'command',
            cmd: name,
            args: [],
            from: { userId: donorId, username: donorName },
            amount,
            at: Date.now(),
            source: 'cime-donation-rule'
          });
        } catch { }
      }

      const tmpl = String(r.response || '').trim();
      const vars = { username: donorName, amount, message: donorMessage };
      let built = tmpl.replace(/\$\{\s*(username|amount|message)\s*\}/g, (_, k) => String(vars[k]));
      try { built = await substituteAllPlaceholders(built, sid, donorId, donorName); } catch { }
      const donationFeatures = [];
      const rlRe = /\$\{\s*roulette::([^}]+)\s*\}/i;
      const rlReAll = /\$\{\s*roulette::([^}]+)\s*\}/ig;
      if (rlRe.test(String(built || ''))) {
        try {
          const m = String(built).match(rlRe);
          const rouletteName = m && m[1] ? String(m[1]).trim() : '';
          built = String(built || '').replace(rlReAll, '').trim();
          if (rouletteName) {
            enqueueRouletteSpin(sid, {
              name: rouletteName,
              userId: donorId,
              username: donorName,
              chatPost: makeCimeChatPost(ownerUserId, donorName),
              instant: false,
              eventContext: { source: 'cime-donation-rule', triggerName: r.name || null }
            });
            donationFeatures.push('roulette');
          }
        } catch { }
      }
      await recordDonationRuleExecutionLog(sid, {
        provider: 'cime',
        channelUid: entry.channelId || null,
        userId: donorId,
        username: donorName,
        ruleId: r.id || null,
        ruleName: r.name || null,
        targetName: donationFeatures.includes('roulette') ? '룰렛 실행' : '채팅 반응',
        amount,
        message: donorMessage,
        features: donationFeatures,
        source: 'cime-donation-rule',
        summary: `후원 반응 실행: ${r.name || '이름 없음'} · ${amount.toLocaleString('ko-KR')}원`,
      });
      built = String(built || '').trim();
      if (built) responsesToSend.push(built);
    }

    for (const msgText of responsesToSend) {
      await sendCimeChat(ownerUserId, msgText).catch(() => { });
      await new Promise(r => setTimeout(r, 120));
    }
  } catch (e) {
    console.error('[CIME] Donation automation error', e?.message || e);
  }
}

async function subscribeCimeEvent(kind, sessionKey, accessToken) {
  const map = {
    chat: '/open/v1/sessions/events/subscribe/chat',
    donation: '/open/v1/sessions/events/subscribe/donation',
    subscription: '/open/v1/sessions/events/subscribe/subscription',
  };
  const url = `${CIME_OPENAPI_BASE}${map[kind]}`;
  await axios.post(url, null, {
    params: { sessionKey },
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

async function ensureCimeSubscribed(entry) {
  if (entry.subscribed.has('ALL')) return;
  const accessToken = await getValidCimeAccessToken(entry.ownerUserId);
  await subscribeCimeEvent('chat', entry.sessionKey, accessToken);
  await subscribeCimeEvent('donation', entry.sessionKey, accessToken);
  await subscribeCimeEvent('subscription', entry.sessionKey, accessToken);
  entry.subscribed.add('ALL');
}

async function ensureCimeSession(ownerUserId) {
  if (!ownerUserId) throw new Error('ownerUserId is required');
  const existing = cimeSessionStore.get(ownerUserId);
  if (existing && existing.connected && existing.ws && existing.ws.readyState === WebSocket.OPEN) {
    await ensureCimeSubscribed(existing);
    return existing;
  }
  if (cimeSessionCreatePromises.has(ownerUserId)) return cimeSessionCreatePromises.get(ownerUserId);

  const createPromise = (async () => {
    const accessToken = await getValidCimeAccessToken(ownerUserId);
    const sessResp = await axios.get(`${CIME_OPENAPI_BASE}/open/v1/sessions/auth`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const content = unwrapOpenApiContent(sessResp);
    const url = content?.url || sessResp?.data?.url;
    if (!url) throw new Error('Failed to create CIME session URL');

    const sessionUrl = new URL(url);
    const sessionKey = sessionUrl.searchParams.get('sessionKey') || sessionUrl.searchParams.get('session_key') || content?.sessionKey || null;
    if (!sessionKey) throw new Error('Failed to determine CIME sessionKey');

    const entry = {
      provider: 'cime',
      ownerUserId,
      primarySid: `user:${ownerUserId}`,
      channelId: await getCimeChannelId(ownerUserId),
      sessionKey,
      ws: null,
      queue: [],
      connected: false,
      subscribed: new Set(),
      processedIds: new Set(),
      sentReplies: new Set(),
      pingTimer: null,
      reconnectTimer: null
    };
    cimeSessionStore.set(ownerUserId, entry);
    activeSids.set(entry.primarySid, Date.now());

    const ws = new WebSocket(url, { handshakeTimeout: 5000 });
    entry.ws = ws;

    ws.on('open', async () => {
      entry.connected = true;
      activeSids.set(entry.primarySid, Date.now());
      try { await ensureCimeSubscribed(entry); } catch (e) { console.error('[CIME] subscribe error', e?.response?.data || e.message); }
      entry.pingTimer = setInterval(() => {
        try {
          if (entry.ws?.readyState === WebSocket.OPEN) entry.ws.send(JSON.stringify({ type: 'PING' }));
        } catch { }
      }, 60 * 1000);
    });

    ws.on('message', (buf) => {
      const parsed = parseCimeEvent(buf.toString('utf8'));
      if (!parsed) return;
      const { eventName, ev } = parsed;
      const dedupeKey = `${eventName}:${ev.id || ev.ts || ''}`;
      if (entry.processedIds.has(dedupeKey)) return;
      entry.processedIds.add(dedupeKey);
      if (entry.processedIds.size > 2000) {
        let i = 0; for (const key of entry.processedIds) { entry.processedIds.delete(key); if (++i >= 200) break; }
      }
      pushEvent(entry, ev);
      activeSids.set(entry.primarySid, Date.now());
      if (eventName === 'CHAT') {
        processCimeChatAutomation(entry, ev).catch(() => { });
      } else if (eventName === 'DONATION') {
        processCimeDonationAutomation(entry, ev).catch(() => { });
      } else if (eventName === 'SUBSCRIPTION') {
        rememberCimeSubscriptionMonths(entry, ev);
      }
    });

    ws.on('close', () => {
      entry.connected = false;
      if (entry.pingTimer) clearInterval(entry.pingTimer);
      entry.pingTimer = null;
      entry.reconnectTimer = setTimeout(() => {
        cimeSessionStore.delete(ownerUserId);
        ensureCimeSession(ownerUserId).catch(() => { });
      }, 3000);
    });

    ws.on('error', (err) => {
      console.error('[CIME] WebSocket error', err?.message || err);
    });

    return entry;
  })();

  cimeSessionCreatePromises.set(ownerUserId, createPromise);
  try {
    return await createPromise;
  } finally {
    cimeSessionCreatePromises.delete(ownerUserId);
  }
}

// Optional: allow client to reset the session for current sid to avoid 429
app.post('/api/chzzk/reset', async (req, res) => {
  try {
    const pid = await getPartitionId(req, res);
    const entry = pid ? sessionStore.get(pid) : null;
    if (entry && entry.socket) {
      try {
        if (entry.socket.connected || typeof entry.socket.disconnect === 'function') {
          entry.socket.disconnect();
        }
      } catch { }
    }
    if (pid) sessionStore.delete(pid);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to reset session' });
  }
});

// Full logout: revoke tokens, clear DB, reset session, and clear sid cookie
app.post('/api/auth/chzzk/logout', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    const tokens = sid ? (await getTokens(sid)) : null;
    if (tokens) {
      try {
        await revokeTokens({
          clientId: CHZZK_CLIENT_ID,
          clientSecret: CHZZK_CLIENT_SECRET,
          token: tokens.accessToken,
          tokenTypeHint: 'access_token',
          baseUrl: OPENAPI_BASE
        });
      } catch { }
      try {
        await revokeTokens({
          clientId: CHZZK_CLIENT_ID,
          clientSecret: CHZZK_CLIENT_SECRET,
          token: tokens.refreshToken,
          tokenTypeHint: 'refresh_token',
          baseUrl: OPENAPI_BASE
        });
      } catch { }
    }
    // remove tokens from DB
    if (sid) await updateTokens(sid, null);
    // reset socket session
    const entry = sid ? sessionStore.get(sid) : null;
    if (entry && entry.socket) {
      try { entry.socket.disconnect(); } catch { }
    }
    if (sid) sessionStore.delete(sid);
    clearManagedCookie(res, 'oauth_state');
    clearManagedCookie(res, 'oauth_state_cime');
    clearManagedCookie(res, 'sid');
    return res.json({ ok: true });
  } catch (e) {
    console.error('Logout error', e?.response?.data || e.message);
    return res.status(500).json({ error: 'Failed to logout' });
  }
});

// Current user's channel info
app.get('/api/chzzk/me', async (req, res) => {
  try {
    let sid = await getPartitionId(req, res);
    if (!sid) {
      // Fallback: try temp tokens and migrate
      const sidToken = getCookieSid(req);
      if (sidToken) {
        const tempPid = `sid:${sidToken}`;
        const tokens = await getTokens(tempPid);
        if (tokens) {
          try {
            const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
              headers: { Authorization: `Bearer ${tokens.tokenType || 'Bearer'} ${tokens.accessToken}` }
            });
            const content = me?.data?.content || me?.data || {};
            if (content?.channelId) {
              const userId = String(content.channelId);
              try { await migrateSidToUserPid(sidToken, userId); } catch { }
              sid = `user:${userId}`;
              // Use existing cookie sid; do NOT rotate
              try { await upsertSession(sidToken, userId, 30); } catch { }
              // Cookie already has sidToken; no need to overwrite
            }
            else {
              console.warn('[CHZZK /me] users/me returned no userId; cookieSid=', sidToken);
            }
          } catch { }
        }
      }
      if (!sid) {
        console.warn('[CHZZK /me] No session after bootstrap. cookieSid=', getCookieSid(req));
        return res.status(401).json({ error: 'No session' });
      }
    }
    const accessToken = await getValidAccessToken(sid);
    const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const content = me?.data?.content || me?.data || {};
    return res.json({ channelId: content.channelId, channelName: content.channelName });
  } catch (e) {
    console.error('me error', e?.response?.data || e.message);
    return res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

app.get('/api/chzzk/events', async (req, res) => {
  try {
    let sid = await getPartitionId(req, res);
    if (!sid) {
      // Fallback: try temp tokens and migrate
      const sidToken = getCookieSid(req);
      if (sidToken) {
        const tempPid = `sid:${sidToken}`;
        const tokens = await getTokens(tempPid);
        if (tokens) {
          try {
            const meTry = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
              headers: { Authorization: `Bearer ${tokens.tokenType || 'Bearer'} ${tokens.accessToken}` }
            });
            const content = meTry?.data?.content || meTry?.data || {};
            if (content?.channelId) {
              const userId = String(content.channelId);
              try { await migrateSidToUserPid(sidToken, userId); } catch { }
              sid = `user:${userId}`;
              const newSidToken = 'rt_' + crypto.randomBytes(32).toString('hex');
              try { await upsertSession(newSidToken, userId, 30); } catch { }
              try { setCookieSid(res, newSidToken); } catch { }
            }
            else {
              console.warn('[CHZZK /events] users/me returned no userId; cookieSid=', sidToken);
            }
          } catch { }
        }
      }
      if (!sid) {
        console.warn('[CHZZK /events] No session after bootstrap. cookieSid=', getCookieSid(req));
        return res.status(401).json({ error: 'No session' });
      }
    }
    activeSids.set(sid, Date.now());
    let { channelId, since } = req.query;
    if (!channelId) {
      // auto-detect user channel
      try {
        const accessToken = await getValidAccessToken(sid);
        const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const content = me?.data?.content || me?.data || {};
        channelId = content.channelId;
        if (!channelId) return res.status(400).json({ error: 'Cannot determine channelId' });
      } catch (e) {
        const msg = (e && e.message) || '';
        if (msg.includes('No tokens stored')) {
          return res.status(401).json({ error: 'No tokens' });
        }
        throw e;
      }
    }

    const liveState = await refreshChzzkLiveStatusForSid(sid, { channelUids: [String(channelId)] });
    if (!liveState.live) {
      return res.json({ events: [], connected: false, live: false, channelId: String(channelId) });
    }

    const entry = await ensureSession(sid, String(channelId));
    const sinceNum = since ? Number(since) : null;
    const events = entry.queue.filter(ev => !sinceNum || (ev.ts && ev.ts > sinceNum));
    // Sort ascending by ts
    events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return res.json({ events, connected: !!entry.connected, live: true, channelId: String(channelId) });
  } catch (e) {
    // console.error('Events error', e?.response?.data || e.message);
    return res.status(500).json({ error: 'Failed to fetch events' });
  }
});

app.get('/api/cime/events', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'No session' });
    const entry = await ensureCimeSession(ownerUserId);
    const sinceNum = req.query.since ? Number(req.query.since) : null;
    const events = entry.queue.filter(ev => !sinceNum || (ev.ts && ev.ts > sinceNum));
    events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return res.json({
      provider: 'cime',
      channelId: entry.channelId || null,
      connected: !!entry.connected,
      events
    });
  } catch (e) {
    console.error('[CIME] Events error', e?.response?.data || e.message);
    const msg = String(e?.message || e);
    const status = msg.includes('No CIME tokens') ? 401 : 500;
    return res.status(status).json({ error: 'Failed to fetch CIME events' });
  }
});

app.get('/api/youtube/events', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'No session' });
    const entry = await ensureYoutubeSession(ownerUserId);
    const sinceNum = req.query.since ? Number(req.query.since) : null;
    const events = entry.queue.filter(ev => !sinceNum || (ev.ts && ev.ts > sinceNum));
    events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return res.json({
      provider: 'youtube',
      channelId: entry.channelId || null,
      liveChatId: entry.liveChatId || null,
      broadcastId: entry.broadcastId || null,
      connected: !!entry.connected,
      live: !!entry.liveChatId,
      lastError: entry.lastError || null,
      events
    });
  } catch (e) {
    console.error('[YouTube] Events error', e?.response?.data || e.message);
    const msg = String(e?.message || e);
    const status = msg.includes('No YouTube tokens') ? 401 : 500;
    return res.status(status).json({ error: 'Failed to fetch YouTube events' });
  }
});

app.post('/api/youtube/reset', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    closeYoutubeSession(ownerUserId, 'reset');
    const entry = await ensureYoutubeSession(ownerUserId);
    return res.json({ ok: true, connected: !!entry.connected, liveChatId: entry.liveChatId || null, lastError: entry.lastError || null });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to reset YouTube session' });
  }
});

app.get('/api/platforms/status', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const sid = `user:${ownerUserId}`;
    const platforms = await listPlatformAccounts(ownerUserId).catch(() => []);
    const byProvider = new Map((platforms || []).map((account) => [String(account.provider || '').toLowerCase(), account]));
    const refresh = String(req.query?.refresh || '').toLowerCase() === 'true';

    const chzzkAccount = byProvider.get('chzzk') || null;
    let chzzkState = liveStatusCache.get(sid);
    let chzzkLive = chzzkState?.provider === 'chzzk' ? !!chzzkState.live : null;
    if (refresh && chzzkAccount?.channel_id) {
      chzzkState = await refreshChzzkLiveStatusForSid(sid, { channelUids: [String(chzzkAccount.channel_id)], force: true }).catch(() => chzzkState);
      if (chzzkState && Object.prototype.hasOwnProperty.call(chzzkState, 'live')) chzzkLive = !!chzzkState.live;
    }

    const cimeAccount = byProvider.get('cime') || null;
    const cimeEntry = cimeSessionStore.get(ownerUserId) || null;
    let cimeLive = null;
    if (cimeAccount) {
      cimeLive = refresh ? await refreshCimeLiveStatus(ownerUserId, sid, cimeAccount.channel_id || cimeAccount.platform_user_id).catch(() => false) : (liveStatusCache.get(sid)?.provider === 'cime' ? !!liveStatusCache.get(sid)?.live : null);
    }

    const youtubeAccount = byProvider.get('youtube') || null;
    const youtubeBotProfile = await getYoutubeBotProfile(YOUTUBE_BOT_PROFILE_ID).catch(() => null);
    const youtubeStreamerChannel = await getYoutubeStreamerChannel(ownerUserId).catch(() => null);
    const youtubeEntry = youtubeSessionStore.get(ownerUserId) || null;
    const youtubeState = refresh && (youtubeAccount || youtubeStreamerChannel)
      ? await refreshYoutubeLiveStatus(ownerUserId, sid, { force: true }).catch(() => liveStatusCache.get(sid))
      : liveStatusCache.get(sid);

    const items = [
      {
        provider: 'chzzk',
        label: 'CHZZK',
        connected: !!chzzkAccount,
        channel: chzzkAccount?.channel_name || chzzkAccount?.channel_id || null,
        live: chzzkLive,
        streamConnected: !!sessionStore.get(sid)?.connected,
        queueSize: Array.isArray(sessionStore.get(sid)?.queue) ? sessionStore.get(sid).queue.length : 0,
        mode: 'socket',
        lastError: null,
        reauthRequired: false,
        ignoredDonations: { count: 0, byReason: {}, recent: [] }
      },
      {
        provider: 'cime',
        label: 'CIME',
        connected: !!cimeAccount,
        channel: cimeAccount?.channel_name || cimeAccount?.channel_id || null,
        live: cimeLive,
        streamConnected: !!cimeEntry?.connected,
        queueSize: Array.isArray(cimeEntry?.queue) ? cimeEntry.queue.length : 0,
        mode: 'websocket',
        lastError: cimeEntry?.lastError || null,
        reauthRequired: false,
        ignoredDonations: { count: 0, byReason: {}, recent: [] }
      },
      {
        provider: 'youtube',
        label: 'YouTube',
        connected: !!youtubeBotProfile?.selectedChannelId && !!youtubeStreamerChannel?.youtubeChannelId,
        channel: youtubeStreamerChannel?.title || youtubeStreamerChannel?.youtubeChannelId || youtubeAccount?.channel_name || youtubeAccount?.channel_id || null,
        live: youtubeState?.provider === 'youtube' ? !!youtubeState.live : null,
        streamConnected: !!youtubeEntry?.connected,
        queueSize: Array.isArray(youtubeEntry?.queue) ? youtubeEntry.queue.length : 0,
        mode: 'youtube-chat',
        lastError: youtubeEntry?.lastError || null,
        lastStatus: youtubeEntry?.lastStatus || null,
        reauthRequired: isYoutubeReauthRequired(youtubeEntry) || youtubeBotProfile?.status === 'reauth_required',
        botConfigured: !!youtubeBotProfile?.selectedChannelId,
        ignoredDonations: getYoutubeIgnoredDonationSummary(youtubeEntry)
      }
    ];

    return res.json({
      userId: ownerUserId,
      items,
      summary: {
        connected: items.filter((item) => item.connected).length,
        live: items.filter((item) => item.live === true).length,
        streamConnected: items.filter((item) => item.streamConnected).length,
        reauthRequired: items.filter((item) => item.reauthRequired).length,
        ignoredDonations: items.reduce((sum, item) => sum + Number(item.ignoredDonations?.count || 0), 0)
      },
      db: getPgPoolStatus()
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load platform status' });
  }
});

app.post('/api/cime/reset', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });
    const entry = cimeSessionStore.get(ownerUserId);
    if (entry) {
      if (entry.pingTimer) clearInterval(entry.pingTimer);
      if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
      try { entry.ws?.close(); } catch { }
      cimeSessionStore.delete(ownerUserId);
    }
    await ensureCimeSession(ownerUserId);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to reset CIME session' });
  }
});

const server = SERVER_HOST
  ? app.listen(PORT, SERVER_HOST, () => {
      console.log(`[server] listening on http://${SERVER_HOST}:${PORT}`);
    })
  : app.listen(PORT, () => {
      console.log(`[server] listening on http://localhost:${PORT}`);
    });

// Bootstrap: ensure sessions for all sids that have tokens on startup
async function bootstrapEnsureSessions() {
  try {
    const sids = await listAllSidsWithTokens();
    if (!Array.isArray(sids) || sids.length === 0) return;
    console.log(`[bootstrap] Ensuring sessions for ${sids.length} sid(s)`);
    // Process sequentially with small delay to avoid burst
    for (const sid of sids) {
      try {
        activeSids.set(sid, Date.now());
        const accessToken = await getValidAccessToken(sid);
        const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const content = me?.data?.content || me?.data || {};
        const channelId = content.channelId || content.channel_id || null;
        if (channelId) {
          await refreshChzzkLiveStatusForSid(sid, { channelUids: [String(channelId)], force: true });
        }
      } catch { }
      await new Promise(r => setTimeout(r, 100));
    }
  } catch { }
}

async function bootstrapEnsureCimeSessions() {
  try {
    const users = await listPlatformTokenUsers('cime');
    if (!Array.isArray(users) || users.length === 0) return;
    console.log(`[bootstrap] Ensuring CIME sessions for ${users.length} account(s)`);
    for (const user of users) {
      const ownerUserId = String(user?.userId || '').trim();
      if (!ownerUserId) continue;
      try { await ensureCimeSession(ownerUserId); } catch (e) {
        console.warn('[bootstrap] CIME session skipped:', ownerUserId, e?.response?.data || e?.message || e);
      }
      await new Promise(r => setTimeout(r, 150));
    }
  } catch (e) {
    console.warn('[bootstrap] CIME session bootstrap failed:', e?.message || e);
  }
}

async function bootstrapEnsureYoutubeSessions() {
  try {
    const users = await listPlatformTokenUsers('youtube');
    if (!Array.isArray(users) || users.length === 0) return;
    console.log(`[bootstrap] Ensuring YouTube sessions for ${users.length} account(s)`);
    for (const user of users) {
      const ownerUserId = String(user?.userId || '').trim();
      if (!ownerUserId) continue;
      try { await ensureYoutubeSession(ownerUserId); } catch (e) {
        console.warn('[bootstrap] YouTube session skipped:', ownerUserId, e?.response?.data || e?.message || e);
      }
      await new Promise(r => setTimeout(r, 150));
    }
  } catch (e) {
    console.warn('[bootstrap] YouTube session bootstrap failed:', e?.message || e);
  }
}

setTimeout(() => {
  bootstrapEnsureSessions().catch(() => { });
  bootstrapEnsureCimeSessions().catch(() => { });
  bootstrapEnsureYoutubeSessions().catch(() => { });
}, 0);

// =============================
//
// =============================

/**
 */
async function gracefulShutdown(signal) {
  console.log(`[Server] Received ${signal}, starting graceful shutdown...`);

  try {
    server.close(() => {
      console.log('[Server] HTTP server closed');
    });

    console.log('[Server] Closing WebSocket connections...');
    connectionPool.shutdown();
    for (const ownerUserId of Array.from(youtubeSessionStore.keys())) {
      closeYoutubeSession(ownerUserId, 'shutdown');
    }

    //
    console.log('[Server] Shutting down resource manager...');
    resourceManager.shutdown();

    console.log('[Server] Clearing caches...');
    channelCache.clear();
    sessionContextCache.clear();

    console.log('[Server] Clearing timers...');
    for (const timer of videoDonationTimers.values()) {
      clearTimeout(timer);
    }
    videoDonationTimers.clear();

    console.log('[Server] Cleaning up database connections...');

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('[Server] Graceful shutdown completed');
    process.exit(0);

  } catch (error) {
    console.error('[Server] Error during graceful shutdown:', error);
    setTimeout(() => process.exit(1), 500);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  if (error.message && error.message.includes('db_termination')) {
    console.log('[Server] Database connection terminated (normal during shutdown)');
    return;
  }

  console.error('[Server] Uncaught Exception:', error);

  if (!process.exitCode) {
    gracefulShutdown('uncaughtException');
  }
});

process.on('unhandledRejection', (reason, promise) => {
  if (reason && reason.message && reason.message.includes('db_termination')) {
    console.log('[Server] Database rejection during shutdown (normal)');
    return;
  }

  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log('[Server] Graceful shutdown handlers registered');

// =============================
// =============================
const WS_ERROR_CODES = {
  NORMAL_CLOSURE: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,          // ?꾨줈?좎퐳 ?ㅻ쪟
  UNSUPPORTED_DATA: 1003,

  INVALID_TOKEN: 4001,
  CHANNEL_MISMATCH: 4002,
  CHANNEL_NOT_FOUND: 4003,
  INSUFFICIENT_PERMISSIONS: 4004,
  RATE_LIMITED: 4005,
  TOKEN_EXPIRED: 4006,
  CHANNEL_ACCESS_DENIED: 4007,
  INVALID_CHANNEL_CONTEXT: 4008,
  CONNECTION_LIMIT_EXCEEDED: 4009,
  SERVER_ERROR: 4010,
  MAINTENANCE_MODE: 4011,
  SUSPICIOUS_ACTIVITY: 4012
};

const WS_ERROR_MESSAGES = {
  [WS_ERROR_CODES.INVALID_TOKEN]: '유효하지 않은 토큰입니다.',
  [WS_ERROR_CODES.CHANNEL_MISMATCH]: '채널 정보가 일치하지 않습니다.',
  [WS_ERROR_CODES.CHANNEL_NOT_FOUND]: '채널을 찾을 수 없습니다.',
  [WS_ERROR_CODES.INSUFFICIENT_PERMISSIONS]: '접근 권한이 없습니다.',
  [WS_ERROR_CODES.RATE_LIMITED]: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  [WS_ERROR_CODES.TOKEN_EXPIRED]: '토큰이 만료되었습니다.',
  [WS_ERROR_CODES.CHANNEL_ACCESS_DENIED]: '채널 접근이 거부되었습니다.',
  [WS_ERROR_CODES.INVALID_CHANNEL_CONTEXT]: '채널 컨텍스트가 유효하지 않습니다.',
  [WS_ERROR_CODES.CONNECTION_LIMIT_EXCEEDED]: '연결 제한을 초과했습니다.',
  [WS_ERROR_CODES.SERVER_ERROR]: '서버 오류가 발생했습니다.',
  [WS_ERROR_CODES.MAINTENANCE_MODE]: '서버 점검 중입니다.',
  [WS_ERROR_CODES.SUSPICIOUS_ACTIVITY]: '의심스러운 활동이 감지되었습니다.',
};

function handleWebSocketError(ws, error, context = {}) {
  let errorCode = WS_ERROR_CODES.SERVER_ERROR;
  let errorMessage = 'Unknown error';

  if (error instanceof ChannelAccessError) {
    switch (error.errorCode) {
      case 'CHANNEL_ACCESS_DENIED':
        errorCode = WS_ERROR_CODES.CHANNEL_ACCESS_DENIED;
        break;
      case 'INVALID_CHANNEL_CONTEXT':
        errorCode = WS_ERROR_CODES.INVALID_CHANNEL_CONTEXT;
        break;
      case 'CHANNEL_NOT_FOUND':
        errorCode = WS_ERROR_CODES.CHANNEL_NOT_FOUND;
        break;
      default:
        errorCode = WS_ERROR_CODES.CHANNEL_MISMATCH;
    }
    errorMessage = error.getUserFriendlyMessage();
  } else if (error.message) {
    if (error.message.includes('Token not found')) {
      errorCode = WS_ERROR_CODES.INVALID_TOKEN;
      errorMessage = '토큰을 찾을 수 없습니다. 새 토큰을 생성해 주세요.';
    } else if (error.message.includes('Token revoked')) {
      errorCode = WS_ERROR_CODES.INVALID_TOKEN;
      errorMessage = '토큰이 취소되었습니다. 새 토큰을 생성해 주세요.';
    } else if (error.message.includes('Invalid token format')) {
      errorCode = WS_ERROR_CODES.INVALID_TOKEN;
      errorMessage = '토큰 형식이 올바르지 않습니다.';
    } else if (error.message.includes('Token validation failed')) {
      errorCode = WS_ERROR_CODES.INVALID_TOKEN;
      errorMessage = '토큰 검증에 실패했습니다.';
    } else if (error.message.includes('token')) {
      errorCode = WS_ERROR_CODES.INVALID_TOKEN;
      errorMessage = WS_ERROR_MESSAGES[errorCode];
    } else if (error.message.includes('channel')) {
      errorCode = WS_ERROR_CODES.CHANNEL_NOT_FOUND;
      errorMessage = WS_ERROR_MESSAGES[errorCode];
    } else if (error.message.includes('permission')) {
      errorCode = WS_ERROR_CODES.INSUFFICIENT_PERMISSIONS;
      errorMessage = WS_ERROR_MESSAGES[errorCode];
    } else if (error.message.includes('Connection limit exceeded')) {
      errorCode = WS_ERROR_CODES.CONNECTION_LIMIT_EXCEEDED;
      errorMessage = '연결 제한을 초과했습니다. 잠시 후 다시 시도해 주세요.';
    } else {
      errorMessage = WS_ERROR_MESSAGES[errorCode] || error.message;
    }
  }

  //
  const logContext = {
    errorCode,
    errorMessage,
    originalError: error.message,
    channelId: context.channelId,
    tokenType: context.tokenType,
    userId: context.userId,
    ip: context.ip,
    userAgent: context.userAgent,
    timestamp: new Date().toISOString()
  };
  try {
    if (ws.readyState === ws.OPEN) {
      ws.close(errorCode, errorMessage);
    }
  } catch (closeError) {
    console.error('[WebSocket] Failed to close connection:', closeError);
  }

  return { errorCode, errorMessage, logContext };
}

/**
 */
async function validateTokenChannelMapping(token, channelId, tokenType) {
  try {
    if (!token || !channelId || !tokenType) {
      console.warn('[Token Validation] Invalid parameters for mapping validation');
      return false;
    }

    let sid = null;
    if (tokenType === 'roulette') {
      sid = rouletteTokenToSid.get(token);
      if (!sid) {
        sid = await findSidByRouletteToken(token);
        if (sid) {
          rouletteTokenToSid.set(token, sid);
        }
      }
    } else if (tokenType === 'pvd') {
      sid = pvdTokenToSid.get(token);
      if (!sid) {
        sid = await findSidByViewerToken(token);
        if (sid) {
          pvdTokenToSid.set(token, sid);
        }
      }
    } else {
      console.warn(`[Token Validation] Invalid token type: ${tokenType}`);
      return false;
    }

    if (!sid) {
      console.warn(`[Token Validation] SID not found for token: ${token.substring(0, 8)}...`);
      return false;
    }

    const channelContext = await getChannelContext(sid);
    if (!channelContext) {
      console.warn(`[Token Validation] Channel context not found for SID: ${sid}`);
      return false;
    }

    const actualChannelId = channelContext.channelId;
    if (actualChannelId !== channelId) {
      console.warn(`[Token Validation] Channel ID mismatch: expected ${channelId}, got ${actualChannelId} for token ${token.substring(0, 8)}...`);
      return false;
    }

    console.log(`[Token Validation] Token-channel mapping verified: ${token.substring(0, 8)}... -> ${channelId}`);
    return true;

  } catch (error) {
    console.error(`[Token Validation] Error validating token-channel mapping:`, error.message);
    return false;
  }
}

/**
 */
function validateWebSocketConnection(ws) {
  try {
    if (!ws) {
      return {
        isValid: false,
        reason: 'WebSocket object is null or undefined',
        shouldRemove: true
      };
    }

    // WebSocket ?곹깭 ?뺤씤
    const readyState = ws.readyState;

    switch (readyState) {
      case 0: // WebSocket.CONNECTING
        return {
          isValid: false,
          reason: 'WebSocket is still connecting',
          shouldRemove: false
        };

      case 1: // WebSocket.OPEN
        try {
          if (typeof ws.ping === 'function') {
            ws.ping();
          }

          return {
            isValid: true,
            reason: 'WebSocket is open and healthy',
            shouldRemove: false
          };
        } catch (pingError) {
          return {
            isValid: false,
            reason: `WebSocket ping failed: ${pingError.message}`,
            shouldRemove: true
          };
        }

      case 2: // WebSocket.CLOSING
        return {
          isValid: false,
          reason: 'WebSocket is closing',
          shouldRemove: true
        };

      case 3: // WebSocket.CLOSED
        return {
          isValid: false,
          reason: 'WebSocket is closed',
          shouldRemove: true
        };

      default:
        return {
          isValid: false,
          reason: `Unknown WebSocket state: ${readyState}`,
          shouldRemove: true
        };
    }

  } catch (error) {
    return {
      isValid: false,
      reason: `WebSocket validation error: ${error.message}`,
      shouldRemove: true
    };
  }
}

async function validateWebSocketTokenConnection(token, tokenType, req) {
  try {
    if (!token || typeof token !== 'string' || token.length < 8) {
      const error = new Error('Invalid token format');
      error.code = 'INVALID_TOKEN_FORMAT';
      throw error;
    }

    if (!tokenType || (tokenType !== 'roulette' && tokenType !== 'pvd')) {
      const error = new Error(`Invalid token type: ${tokenType}`);
      error.code = 'INVALID_TOKEN_TYPE';
      throw error;
    }

    let sid = null;
    let isFromCache = false;
    let channelContext = null;

    if (tokenType === 'roulette') {
      sid = rouletteTokenToSid.get(token);
      if (sid) {
        isFromCache = true;

        try {
          const dbSid = await findSidByRouletteToken(token);
          if (dbSid !== sid) {
            if (dbSid) {
              rouletteTokenToSid.set(token, dbSid);
              sid = dbSid;
            } else {
              rouletteTokenToSid.delete(token);
              const error = new Error('Token no longer exists in database');
              error.code = 'TOKEN_NOT_FOUND';
              throw error;
            }
          }
        } catch (dbError) {
          rouletteTokenToSid.delete(token);
          const error = new Error(`Token validation failed: ${dbError.message}`);
          error.code = 'TOKEN_VALIDATION_FAILED';
          error.originalError = dbError;
          throw error;
        }
      } else {
        //
        try {
          sid = await findSidByRouletteToken(token);
          if (sid) {
            rouletteTokenToSid.set(token, sid);
          }
        } catch (dbError) {
          const error = new Error(`Database query failed: ${dbError.message}`);
          error.code = 'DATABASE_ERROR';
          error.originalError = dbError;
          throw error;
        }
      }

      if (sid) {
        try {
          const rouletteSession = await getRouletteSessionByToken(token);
          if (rouletteSession && rouletteSession.sid !== sid) {
            rouletteTokenToSid.delete(token);
            const error = new Error('Token session mismatch');
            error.code = 'SESSION_MISMATCH';
            throw error;
          }
        } catch (sessionError) {
          if (sessionError.code) {
            throw sessionError;
          }
          rouletteTokenToSid.delete(token);
          const error = new Error(`Token session validation failed: ${sessionError.message}`);
          error.code = 'SESSION_VALIDATION_FAILED';
          error.originalError = sessionError;
          throw error;
        }
      }
    } else if (tokenType === 'pvd') {
      sid = pvdTokenToSid.get(token);
      if (sid) {
        isFromCache = true;

        try {
          const dbSid = await findSidByViewerToken(token);
          if (dbSid !== sid) {
            if (dbSid) {
              pvdTokenToSid.set(token, dbSid);
              sid = dbSid;
            } else {
              pvdTokenToSid.delete(token);
              const error = new Error('Token no longer exists in database');
              error.code = 'TOKEN_NOT_FOUND';
              throw error;
            }
          }
        } catch (dbError) {
          pvdTokenToSid.delete(token);
          const error = new Error(`Token validation failed: ${dbError.message}`);
          error.code = 'TOKEN_VALIDATION_FAILED';
          error.originalError = dbError;
          throw error;
        }
      } else {
        //
        try {
          sid = await findSidByViewerToken(token);
          if (sid) {
            pvdTokenToSid.set(token, sid);
          }
        } catch (dbError) {
          const error = new Error(`Database query failed: ${dbError.message}`);
          error.code = 'DATABASE_ERROR';
          error.originalError = dbError;
          throw error;
        }
      }

      if (sid) {
        try {
          const settings = await getBotSettings(sid);
          if (!settings) {
            pvdTokenToSid.delete(token);
            const error = new Error('Bot settings not found');
            error.code = 'SETTINGS_NOT_FOUND';
            throw error;
          }

          if (!settings.videoDonationViewerToken) {
            pvdTokenToSid.delete(token);
            const error = new Error('PVD token not configured');
            error.code = 'TOKEN_NOT_CONFIGURED';
            throw error;
          }

          if (settings.videoDonationViewerToken !== token) {
            pvdTokenToSid.delete(token);
            const error = new Error('Token revoked or invalid');
            error.code = 'TOKEN_REVOKED';
            throw error;
          }
        } catch (settingsError) {
          if (settingsError.code) {
            throw settingsError;
          }
          pvdTokenToSid.delete(token);
          const error = new Error(`Token validation failed: ${settingsError.message}`);
          error.code = 'SETTINGS_VALIDATION_FAILED';
          error.originalError = settingsError;
          throw error;
        }
      }
    }

    if (!sid) {
      const error = new Error('Token not found');
      error.code = 'TOKEN_NOT_FOUND';
      throw error;
    }

    try {
      channelContext = await getChannelContext(sid);
    } catch (contextError) {
      const error = new Error(`Channel context retrieval failed: ${contextError.message}`);
      error.code = 'CONTEXT_RETRIEVAL_FAILED';
      error.originalError = contextError;
      throw error;
    }

    if (!channelContext) {
      if (tokenType === 'roulette') {
        rouletteTokenToSid.delete(token);
      } else if (tokenType === 'pvd') {
        pvdTokenToSid.delete(token);
      }
      const error = new Error('Invalid channel context');
      error.code = 'INVALID_CHANNEL_CONTEXT';
      throw error;
    }

    const expectedChannelId = channelContext.channelId;
    if (!expectedChannelId || typeof expectedChannelId !== 'string' || expectedChannelId.trim().length === 0) {
      if (tokenType === 'roulette') {
        rouletteTokenToSid.delete(token);
      } else if (tokenType === 'pvd') {
        pvdTokenToSid.delete(token);
      }
      const error = new Error('Invalid channel context: missing or invalid channelId');
      error.code = 'INVALID_CHANNEL_ID';
      throw error;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(expectedChannelId)) {
      const error = new Error(`Invalid channel ID format: ${expectedChannelId}`);
      error.code = 'INVALID_CHANNEL_FORMAT';
      throw error;
    }

    if (tokenType === 'roulette') {
      const currentMappedSid = rouletteTokenToSid.get(token);
      if (currentMappedSid !== sid) {
        rouletteTokenToSid.set(token, sid);
      }

      try {
        const mappingValid = await validateTokenChannelMapping(token, expectedChannelId, 'roulette');
        if (!mappingValid) {
          rouletteTokenToSid.delete(token);
          const error = new Error('Token-channel mapping validation failed');
          error.code = 'MAPPING_VALIDATION_FAILED';
          throw error;
        }
      } catch (mappingError) {
        if (mappingError.code === 'MAPPING_VALIDATION_FAILED') {
          throw mappingError;
        }
      }

    } else if (tokenType === 'pvd') {
      const currentMappedSid = pvdTokenToSid.get(token);
      if (currentMappedSid !== sid) {
        pvdTokenToSid.set(token, sid);
      }

      try {
        const mappingValid = await validateTokenChannelMapping(token, expectedChannelId, 'pvd');
        if (!mappingValid) {
          pvdTokenToSid.delete(token);
          const error = new Error('Token-channel mapping validation failed');
          error.code = 'MAPPING_VALIDATION_FAILED';
          throw error;
        }
      } catch (mappingError) {
        if (mappingError.code === 'MAPPING_VALIDATION_FAILED') {
          throw mappingError;
        }
      }
    }

    return {
      sid,
      channelId: channelContext.channelId,
      userId: channelContext.userId,
      channelContext,
      tokenMappingVerified: true,
      mappingSource: isFromCache ? 'cache' : 'database',
      validationTimestamp: Date.now()
    };

  } catch (error) {
    //
    const errorInfo = {
      tokenType,
      token: token?.substring(0, 8) + '...',
      errorCode: error.code || 'UNKNOWN_ERROR',
      errorMessage: error.message,
      timestamp: new Date().toISOString()
    };

    if (error.originalError) {
      errorInfo.originalError = error.originalError.message;
    }

    if (!error.code) {
      error.code = 'VALIDATION_FAILED';
    }

    throw error;
  }
}

// WebSocket servers (initialized below)
let wssPvd; // PVD viewer WS (noServer mode)
let wssPvdAdmin; // PVD admin queue WS (noServer mode)
let wssDrawingOverlay; // Drawing donation overlay WS (noServer mode)
let wssDrawingAdmin; // Drawing donation admin queue WS (noServer mode)
let wssRoulette; // Roulette viewer WS (noServer mode)
let wssPrediction; // Prediction overlay WS (noServer mode)
let wssAutomationLocalAgent; // Local automation program WS
let wssFx; // FX overlay WS (noServer mode)
const predictionChannelSockets = new Map(); // channelUid -> Set<WebSocket>
const fxSidSockets = new Map(); // sid -> Set<WebSocket>
const predictionAutoLockTimers = new Map(); // predictionId -> timeout

function registerPvdRoutes() {
  // --- WebSocket for PVD viewer sync ---
  // Path: /api/pvd/ws?token=<viewer_token>
  console.log('[pvd ws] registerPvdRoutes: initializing WebSocketServer on /api/pvd/ws');
  // Initialize WS server in noServer mode; single dispatcher will route upgrades
  wssPvd = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    perMessageDeflate: false,
  });
  wssPvd.on('connection', async (ws, req) => {
    let channelId = null;
    let token = null;
    let sid = null;
    let validationResult = null;

    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      token = String(url.searchParams.get('token') || '');
      const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString();
      const userAgent = req.headers['user-agent'] || '';

      validationResult = await validateWebSocketTokenConnection(token, 'pvd', req);

      sid = validationResult.sid;
      channelId = validationResult.channelId;

      console.log('[PVD WS] Connection validated:', {
        channelId,
        userId: validationResult.userId,
        tokenPrefix: token.substring(0, 8) + '...',
        ip
      });

      const registered = registerChannelConnection(channelId, 'pvd', token, ws);
      if (!registered) {
        const error = new Error('Connection limit exceeded');
        handleWebSocketError(ws, error, {
          channelId,
          tokenType: 'pvd',
          userId: validationResult.userId,
          ip,
          userAgent
        });
        return;
      }

      let set = pvdSidSockets.get(sid);
      if (!set) { set = new Set(); pvdSidSockets.set(sid, set); }
      set.add(ws);

      console.log(`[PVD WS] Connected - Channel: ${channelId}, SID: ${sid}, Token: ${token.substring(0, 8)}..., IP: ${ip}`);

      // Log negotiated extensions if any
      const negotiated = (ws && (ws.extensions || (ws._extensions && Object.keys(ws._extensions)))) || undefined;

      // Keepalive: ping every 30s to keep proxies from closing idle connections
      const ka = setInterval(() => {
        try { ws.ping(); } catch { }
      }, 30000);
      ws.on('pong', () => { /* optional: mark alive */ });

      // Immediately send current now-playing to this socket so late joiners auto-start
      try {
        const q = getVideoQueue(sid);
        if (q[0]) await refreshChzzkClipPlaybackForItem(q[0]);
        const state = pvdPlaybackState.get(sid) || (q[0] ? createPvdPlaybackState(q[0]) : null);
        if (q[0] && state && !pvdPlaybackState.has(sid)) {
          pvdPlaybackState.set(sid, state);
        }
        const payload = {
          type: 'start',
          channelId,
          item: q[0] || null,
          queue: q,
          startedAt: q[0] ? state?.baseStartMs || null : null,
          paused: q[0] ? state?.paused || false : null,
          atSec: q[0] ? getCurrentAtSec(sid) : 0,
          elapsedSec: q[0] ? getCurrentPvdElapsedSec(sid) : 0,
          serverNow: Date.now()
        };
        ws.send(JSON.stringify(payload), { compress: false });
      } catch (error) {
        console.error('[PVD WS] Error sending initial payload:', error);
      }

      ws.on('close', (code, reason) => {
        try { clearInterval(ka); } catch { }

        if (channelId && token) {
          unregisterChannelConnection(channelId, 'pvd', token, ws);
        }

        try {
          const set = pvdSidSockets.get(sid);
          if (set) {
            set.delete(ws);
            if (set.size === 0) {
              pvdSidSockets.delete(sid);
            }
          }
        } catch { }

        console.log(`[PVD WS] Disconnected - Channel: ${channelId}, SID: ${sid}, Code: ${code}, Reason: ${reason}`);
      });

      ws.on('error', (error) => {
        const context = {
          channelId,
          tokenType: 'pvd',
          userId: validationResult?.userId,
          ip: (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString(),
          userAgent: req.headers['user-agent'] || ''
        };

        handleWebSocketError(ws, error, context);
      });

    } catch (error) {
      const context = {
        channelId,
        tokenType: 'pvd',
        userId: validationResult?.userId,
        ip: (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString(),
        userAgent: req.headers['user-agent'] || ''
      };

      if (channelId && token) {
        unregisterChannelConnection(channelId, 'pvd', token, ws);
      }

      handleWebSocketError(ws, error, context);
    }
  });
}

// Initialize WebSocket routes (PVD)
try { registerPvdRoutes(); } catch (e) { console.error('[pvd ws] failed to register routes', e?.message || e); }

function registerPvdAdminRoutes() {
  console.log('[pvd admin ws] initializing WebSocketServer on /api/video-donation/admin/ws');
  wssPvdAdmin = new WebSocketServer({
    noServer: true,
    maxPayload: 32 * 1024,
    perMessageDeflate: false,
  });

  wssPvdAdmin.on('connection', async (ws, req) => {
    let sid = null;
    try {
      sid = await getPvdAdminSidFromRequest(req);
      if (!sid) {
        try { ws.close(1008, 'Login required'); } catch { }
        return;
      }

      let set = pvdAdminSockets.get(sid);
      if (!set) { set = new Set(); pvdAdminSockets.set(sid, set); }
      set.add(ws);

      const keepAlive = setInterval(() => {
        try { ws.ping(); } catch { }
      }, 30000);

      const initial = await getPvdQueueSnapshot(sid, 'connected').catch(() => null);
      if (initial) {
        try { ws.send(JSON.stringify(initial), { compress: false }); } catch { }
      }

      ws.on('message', async (raw) => {
        try {
          const message = JSON.parse(String(raw || '{}'));
          if (message?.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', serverNow: Date.now() }), { compress: false });
          }
        } catch { }
      });

      ws.on('close', () => {
        try { clearInterval(keepAlive); } catch { }
        const sockets = pvdAdminSockets.get(sid);
        if (sockets) {
          sockets.delete(ws);
          if (sockets.size === 0) pvdAdminSockets.delete(sid);
        }
      });
      ws.on('error', () => {
        try { ws.close(); } catch { }
      });
    } catch (error) {
      console.error('[pvd admin ws] connection error', error?.message || error);
      try { ws.close(1011, 'PVD admin websocket error'); } catch { }
    }
  });
}

try { registerPvdAdminRoutes(); } catch (e) { console.error('[pvd admin ws] failed to register routes', e?.message || e); }

function registerDrawingDonationWsRoutes() {
  console.log('[drawing donation ws] initializing WebSocketServer on /api/drawing-donation/ws');
  wssDrawingOverlay = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });

  wssDrawingOverlay.on('connection', async (ws, req) => {
    let sid = null;
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const token = String(url.searchParams.get('token') || '').trim();
      sid = await getDrawingSidByToken(token);
      if (!sid) {
        try { ws.close(1008, 'Invalid token'); } catch {}
        return;
      }

      let set = drawingOverlaySockets.get(sid);
      if (!set) { set = new Set(); drawingOverlaySockets.set(sid, set); }
      set.add(ws);

      const keepAlive = setInterval(() => {
        try { ws.ping(); } catch {}
      }, 30000);

      const item = await getCurrentDrawingItemForSid(sid).catch(() => null);
      try {
        ws.send(JSON.stringify({ type: 'drawing-donation.current', reason: 'connected', item, serverNow: Date.now() }), { compress: false });
      } catch {}

      ws.on('message', async (raw) => {
        try {
          const message = JSON.parse(String(raw || '{}'));
          if (message?.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', serverNow: Date.now() }), { compress: false });
          }
        } catch {}
      });

      ws.on('close', () => {
        try { clearInterval(keepAlive); } catch {}
        const sockets = drawingOverlaySockets.get(sid);
        if (sockets) {
          sockets.delete(ws);
          if (sockets.size === 0) drawingOverlaySockets.delete(sid);
        }
      });
      ws.on('error', () => {
        try { ws.close(); } catch {}
      });
    } catch (error) {
      console.error('[drawing donation ws] connection error', error?.message || error);
      try { ws.close(1011, 'Drawing donation websocket error'); } catch {}
    }
  });

  console.log('[drawing donation admin ws] initializing WebSocketServer on /api/drawing-donation/admin/ws');
  wssDrawingAdmin = new WebSocketServer({
    noServer: true,
    maxPayload: 32 * 1024,
    perMessageDeflate: false,
  });

  wssDrawingAdmin.on('connection', async (ws, req) => {
    let sid = null;
    try {
      sid = await getPvdAdminSidFromRequest(req);
      if (!sid) {
        try { ws.close(1008, 'Login required'); } catch {}
        return;
      }

      let set = drawingAdminSockets.get(sid);
      if (!set) { set = new Set(); drawingAdminSockets.set(sid, set); }
      set.add(ws);

      const keepAlive = setInterval(() => {
        try { ws.ping(); } catch {}
      }, 30000);

      const initial = await getDrawingQueueSnapshot(sid, 'connected').catch(() => null);
      if (initial) {
        try { ws.send(JSON.stringify(initial), { compress: false }); } catch {}
      }

      ws.on('message', async (raw) => {
        try {
          const message = JSON.parse(String(raw || '{}'));
          if (message?.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', serverNow: Date.now() }), { compress: false });
          }
        } catch {}
      });

      ws.on('close', () => {
        try { clearInterval(keepAlive); } catch {}
        const sockets = drawingAdminSockets.get(sid);
        if (sockets) {
          sockets.delete(ws);
          if (sockets.size === 0) drawingAdminSockets.delete(sid);
        }
      });
      ws.on('error', () => {
        try { ws.close(); } catch {}
      });
    } catch (error) {
      console.error('[drawing donation admin ws] connection error', error?.message || error);
      try { ws.close(1011, 'Drawing donation admin websocket error'); } catch {}
    }
  });
}

try { registerDrawingDonationWsRoutes(); } catch (e) { console.error('[drawing donation ws] failed to register routes', e?.message || e); }

function getPredictionChannelKey(channelUid) {
  return String(channelUid || '').trim();
}

function toPublicPrediction(prediction) {
  if (!prediction) return null;
  return {
    id: prediction.id,
    channelUid: prediction.channelUid,
    question: prediction.question,
    status: prediction.status,
    command: prediction.command || '!투표',
    minBet: prediction.minBet,
    maxBet: prediction.maxBet,
    options: Array.isArray(prediction.options) ? prediction.options.map((option) => ({
      id: option.id,
      label: option.label,
      total: Number(option.total || 0),
      count: Number(option.count || 0),
      percentage: Number(option.percentage || 0),
      payoutMultiplier: option.payoutMultiplier ?? null,
      payoutPer100: option.payoutPer100 ?? null,
    })) : [],
    winningOptionId: prediction.winningOptionId || null,
    totalPoints: Number(prediction.totalPoints || 0),
    participantCount: Number(prediction.participantCount || 0),
    createdAt: prediction.createdAt || null,
    closesAt: prediction.closesAt || null,
    lockedAt: prediction.lockedAt || null,
    settledAt: prediction.settledAt || null,
  };
}

function sendPredictionWs(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify({ ...payload, serverNow: Date.now() }), { compress: false });
    return true;
  } catch {
    return false;
  }
}

function broadcastPredictionSnapshot(channelUid, prediction, event = 'prediction:update') {
  const keys = Array.from(new Set([
    getPredictionChannelKey(channelUid),
    getPredictionChannelKey(prediction?.channelUid),
  ].filter(Boolean)));
  if (!keys.length) return { total: 0, sent: 0 };
  let total = 0;
  let sent = 0;
  for (const key of keys) {
    const sockets = predictionChannelSockets.get(key);
    if (!sockets || sockets.size === 0) continue;
    total += sockets.size;
    for (const ws of Array.from(sockets)) {
      if (sendPredictionWs(ws, { type: event, channelUid: key, prediction: toPublicPrediction(prediction) })) {
        sent += 1;
      } else {
        try { sockets.delete(ws); } catch { }
      }
    }
    if (sockets.size === 0) predictionChannelSockets.delete(key);
  }
  return { total, sent };
}

function broadcastPredictionClear(channelUid) {
  return broadcastPredictionSnapshot(channelUid, null, 'prediction:clear');
}

function schedulePredictionAutoLock(prediction) {
  if (!prediction?.id || !prediction?.sid || prediction.status !== 'open' || !prediction.closesAt) return;
  try {
    const closesAt = new Date(prediction.closesAt).getTime();
    const delay = closesAt - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) return;
    if (predictionAutoLockTimers.has(prediction.id)) {
      clearTimeout(predictionAutoLockTimers.get(prediction.id));
      predictionAutoLockTimers.delete(prediction.id);
    }
    const timer = setTimeout(async () => {
      predictionAutoLockTimers.delete(prediction.id);
      try {
        const locked = await lockPredictionForSid(prediction.sid, prediction.id);
        if (locked) broadcastPredictionSnapshot(locked.channelUid, locked, 'prediction:update');
      } catch (error) {
        console.warn('[Prediction WS] auto lock failed:', error?.message || error);
      }
    }, Math.min(delay, 2 ** 31 - 1));
    timer.unref?.();
    predictionAutoLockTimers.set(prediction.id, timer);
  } catch { }
}

function registerPredictionRoutes() {
  console.log('[prediction ws] initializing WebSocketServer on /api/prediction/ws');
  wssPrediction = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });

  wssPrediction.on('connection', async (ws, req) => {
    let channelUid = '';
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      channelUid = getPredictionChannelKey(url.searchParams.get('channelUid') || url.searchParams.get('uid'));
      if (!channelUid || channelUid.length > 128 || !/^[\w:.-]+$/.test(channelUid)) {
        try { ws.close(1008, 'Invalid channelUid'); } catch { }
        return;
      }

      let sockets = predictionChannelSockets.get(channelUid);
      if (!sockets) {
        sockets = new Set();
        predictionChannelSockets.set(channelUid, sockets);
      }
      sockets.add(ws);

      const keepAlive = setInterval(() => {
        try { ws.ping(); } catch { }
      }, 30000);

      try {
        const prediction = await getActivePredictionForChannel(channelUid, { includeRecentlySettled: true, resultVisibleMs: 5000 });
        if (prediction) schedulePredictionAutoLock(prediction);
        sendPredictionWs(ws, { type: 'prediction:snapshot', channelUid, prediction: toPublicPrediction(prediction) });
      } catch (error) {
        sendPredictionWs(ws, { type: 'prediction:error', channelUid, error: 'snapshot_failed' });
      }

      ws.on('message', async (raw) => {
        try {
          const message = JSON.parse(String(raw || '{}'));
          if (message?.type === 'ping') {
            sendPredictionWs(ws, { type: 'pong', channelUid });
          }
        } catch { }
      });

      ws.on('close', () => {
        try { clearInterval(keepAlive); } catch { }
        const set = predictionChannelSockets.get(channelUid);
        if (set) {
          set.delete(ws);
          if (set.size === 0) predictionChannelSockets.delete(channelUid);
        }
      });
      ws.on('error', () => {
        try { ws.close(); } catch { }
      });
    } catch (error) {
      console.error('[prediction ws] connection error', error?.message || error);
      try { ws.close(1011, 'Prediction websocket error'); } catch { }
    }
  });
}

try { registerPredictionRoutes(); } catch (e) { console.error('[prediction ws] failed to register routes', e?.message || e); }

// Initialize WebSocket routes (Roulette)
function registerRouletteRoutes() {
  console.log('[roulette ws] initializing WebSocketServer on /api/roulette/ws');
  wssRoulette = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
  wssRoulette.on('connection', async (ws, req) => {
    let channelId = null;
    let token = null;
    let validationResult = null;

    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      token = String(url.searchParams.get('token') || '');
      const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString();
      const userAgent = req.headers['user-agent'] || '';

      validationResult = await validateWebSocketTokenConnection(token, 'roulette', req);

      channelId = validationResult.channelId;

      console.log('[Roulette WS] Connection validated:', {
        channelId,
        userId: validationResult.userId,
        tokenPrefix: token.substring(0, 8) + '...',
        ip
      });

      const registered = registerChannelConnection(channelId, 'roulette', token, ws);
      if (!registered) {
        const error = new Error('Connection limit exceeded');
        handleWebSocketError(ws, error, {
          channelId,
          tokenType: 'roulette',
          userId: validationResult.userId,
          ip,
          userAgent
        });
        return;
      }


      console.log(`[Roulette WS] Connected - Channel: ${channelId}, Token: ${token.substring(0, 8)}...`);

      // Send current stored result if exists
      try {
        const row = await getRouletteSessionByToken(token);
        if (row) {
          // Try to resolve items/theme using validated sid from connection
          let theme = null;
          let items = null;
          try {
            const sid = validationResult.sid;

            const cachedSid = rouletteTokenToSid.get(token);
            if (cachedSid !== sid) {
              console.warn(`[Roulette WS] Token-SID mapping inconsistency detected: cached=${cachedSid}, validated=${sid}`);
              rouletteTokenToSid.set(token, sid);
              console.log(`[Roulette WS] Token-SID mapping corrected: ${token.substring(0, 8)}... -> ${sid}`);
            } else {
              console.log(`[Roulette WS] Token-SID mapping verified: ${token.substring(0, 8)}... -> ${sid}`);
            }

            if (channelId && sid) {
              const cacheKey = `${sid}_roulette_mapping`;
              const mappingData = {
                token: token,
                channelId: channelId,
                sid: sid,
                verifiedAt: Date.now(),
                source: 'websocket_connection'
              };
              channelCache.set(channelId, cacheKey, mappingData, 15 * 60 * 1000);
            }

            if (sid) {
              const settings = await getBotSettings(sid) || {};
              const defs = getRouletteDefsFromSettings(settings);
              const def = defs.find(d => String(d.name).toLowerCase() === String(row.roulette_name || '').toLowerCase());
              if (def) {
                theme = def.theme || null;
                items = Array.isArray(def.items) ? def.items.map(it => String(it.label || '')).filter(Boolean) : null;
              }
            }
          } catch (settingsError) {
            console.error('[Roulette WS] Error resolving roulette settings:', settingsError);
          }

          // Augment with last batch meta if available
          let meta = rouletteTokenLastBatch.get(token) || null;
          const payload = {
            type: 'roulette',
            token,
            channelId,
            name: row.roulette_name || null,
            username: row.username || null,
            value: row.result_value ?? null,
            label: row.result_label || null,
            createdAt: row.created_at || null,
            theme,
            items,
            batchId: meta?.batchId || null,
            batchCount: meta?.batchCount || 1
          };
          ws.send(JSON.stringify(payload));
        }
      } catch (error) {
        console.error('[Roulette WS] Error sending stored result:', error);
      }

      // Keepalive
      const ka = setInterval(() => { try { ws.ping(); } catch { } }, 30000);

      ws.on('close', (code, reason) => {
        try { clearInterval(ka); } catch { }

        if (channelId && token) {
          unregisterChannelConnection(channelId, 'roulette', token, ws);
        }


        console.log(`[Roulette WS] Disconnected - Channel: ${channelId}, Code: ${code}, Reason: ${reason}`);
      });

      ws.on('error', (error) => {
        const context = {
          channelId,
          tokenType: 'roulette',
          userId: validationResult?.userId,
          ip: (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString(),
          userAgent: req.headers['user-agent'] || ''
        };

        handleWebSocketError(ws, error, context);
      });

    } catch (error) {
      const context = {
        channelId,
        tokenType: 'roulette',
        userId: validationResult?.userId,
        ip: (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString(),
        userAgent: req.headers['user-agent'] || ''
      };

      if (channelId && token) {
        unregisterChannelConnection(channelId, 'roulette', token, ws);
      }

      handleWebSocketError(ws, error, context);
    }
  });
}

try { registerRouletteRoutes(); } catch (e) { console.error('[roulette ws] failed to register routes', e?.message || e); }

function registerFxRoutes() {
  console.log('[fx ws] initializing WebSocketServer on /api/fx/ws');
  wssFx = new WebSocketServer({
    noServer: true,
    maxPayload: 128 * 1024,
    perMessageDeflate: false,
  });
  wssFx.on('connection', async (ws, req) => {
    let sid = null;
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const token = String(url.searchParams.get('token') || '').trim();
      if (!token) {
        try { ws.close(1008, 'Missing FX token'); } catch { }
        return;
      }
      sid = await findSidByChannelViewerTokenSupabase(token, 'fx').catch(() => null);
      if (!sid) {
        try {
          const { data } = await getBotSettingsByFxTokenFallback(token);
          sid = data;
        } catch { }
      }
      if (!sid) {
        try { ws.close(1008, 'Invalid FX token'); } catch { }
        return;
      }
      let sockets = fxSidSockets.get(sid);
      if (!sockets) {
        sockets = new Set();
        fxSidSockets.set(sid, sockets);
      }
      sockets.add(ws);
      try { ws.send(JSON.stringify({ type: 'hello', sid, serverNow: Date.now() }), { compress: false }); } catch { }
      const keepAlive = setInterval(() => { try { ws.ping(); } catch { } }, 30000);
      ws.on('message', (raw) => {
        try {
          const message = JSON.parse(String(raw));
          if (message?.type === 'ping') ws.send(JSON.stringify({ type: 'pong', serverNow: Date.now() }), { compress: false });
        } catch { }
      });
      ws.on('close', () => {
        try { clearInterval(keepAlive); } catch { }
        const set = fxSidSockets.get(sid);
        if (set) {
          set.delete(ws);
          if (set.size === 0) fxSidSockets.delete(sid);
        }
      });
      ws.on('error', () => { try { ws.close(); } catch { } });
    } catch (error) {
      console.error('[fx ws] connection error', error?.message || error);
      try { ws.close(1011, 'FX websocket error'); } catch { }
    }
  });
}

async function getBotSettingsByFxTokenFallback(token) {
  for (const sid of Array.from(activeSids.keys())) {
    const settings = await getBotSettings(sid).catch(() => null) || {};
    if (settings.fxViewerToken === token) return { data: sid };
  }
  return { data: null };
}

try { registerFxRoutes(); } catch (e) { console.error('[fx ws] failed to register routes', e?.message || e); }

function registerAutomationLocalAgentRoutes() {
  console.log('[automation local ws] initializing WebSocketServer on /api/automations/local-agent/ws');
  wssAutomationLocalAgent = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  wssAutomationLocalAgent.on('connection', async (ws, req) => {
    let agent = null;
    let unregister = () => {};
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const auth = String(req.headers.authorization || '').trim();
      const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
      const token = bearer || String(req.headers['x-local-agent-token'] || '').trim();
      agent = await authenticateAutomationLocalAgent(token);
      if (!agent) {
        try { ws.close(1008, 'Invalid local program token'); } catch { }
        return;
      }
      unregister = registerAutomationLocalAgentSocket(agent, ws);
      await touchAutomationLocalAgent(agent.id, {
        transport: 'websocket',
        version: String(req.headers['x-arubot-local-version'] || ''),
      }).catch(() => null);
      try { ws.send(JSON.stringify({ type: 'hello', at: new Date().toISOString() })); } catch { }
      try { ws.send(JSON.stringify({ type: 'jobs.available', reason: 'connected', at: new Date().toISOString() })); } catch { }

      const keepAlive = setInterval(() => {
        try { ws.ping(); } catch { }
      }, 30000);

      ws.on('message', async (raw) => {
        let message = null;
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (message?.type === 'heartbeat') {
          await touchAutomationLocalAgent(agent.id, getAutomationCapabilitiesFromMessage(message)).catch(() => null);
          try { ws.send(JSON.stringify({ type: 'heartbeat.ack', at: new Date().toISOString() })); } catch { }
        }
      });

      ws.on('close', () => {
        try { clearInterval(keepAlive); } catch { }
        unregister();
      });
      ws.on('error', () => {
        try { ws.close(); } catch { }
      });
    } catch (error) {
      unregister();
      console.error('[automation local ws] connection error', error?.message || error);
      try { ws.close(1011, 'Local program websocket error'); } catch { }
    }
  });
}

try { registerAutomationLocalAgentRoutes(); } catch (e) { console.error('[automation local ws] failed to register routes', e?.message || e); }

// --- WebSocket for WARUDO direct push ---
// Path: /api/warudo/ws?token=<API_KEY>
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 1024 * 1024,
  perMessageDeflate: {
    serverNoContextTakeover: true,
    clientNoContextTakeover: true,
    clientMaxWindowBits: true,
    serverMaxWindowBits: 15,
    zlibDeflateOptions: { windowBits: 15, memLevel: 8, level: 6 },
    zlibInflateOptions: { windowBits: 15 }
  }
});

// --- WebSocket for Electron Desktop Client ---
// Path: /api/desktop/ws?token=<API_KEY>
const wssDesktop = new WebSocketServer({
  noServer: true,
  maxPayload: 1024 * 1024,
  perMessageDeflate: false,
});

wssDesktop.on('connection', async (ws, req) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const token = String(url.searchParams.get('token') || '');
    const pid = await getOwnerPidForApiKey(token);
    if (!pid) {
      try { ws.close(1008, 'Invalid token'); } catch { }
      return;
    }
    // Register socket for this pid
    let set = desktopPidSockets.get(pid);
    if (!set) { set = new Set(); desktopPidSockets.set(pid, set); }
    set.add(ws);
    // Touch API key last used
    try { await touchApiKeyLastUsed(token); } catch { }

    // Keepalive ping
    const ka = setInterval(() => { try { ws.ping(); } catch { } }, 30000);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg && msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', serverNow: Date.now() }));
          return;
        }
        // Broadcast to other desktop clients of same pid if needed
        const peers = desktopPidSockets.get(pid);
        if (peers) {
          for (const peer of Array.from(peers)) {
            if (peer !== ws && peer.readyState === 1) {
              try { peer.send(JSON.stringify({ type: 'relay', payload: msg })); } catch { }
            }
          }
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on('close', () => {
      try { clearInterval(ka); } catch { }
      const s = desktopPidSockets.get(pid);
      if (s) { s.delete(ws); if (s.size === 0) desktopPidSockets.delete(pid); }
    });
    ws.on('error', () => { try { ws.close(); } catch { } });

    // Send initial hello
    try { ws.send(JSON.stringify({ type: 'hello', instance: INSTANCE_ID, serverNow: Date.now() })); } catch { }
  } catch {
    try { ws.close(); } catch { }
  }
});

// Single upgrade dispatcher for both WS servers
try {
  server.on('upgrade', (req, socket, head) => {
    try {
      const u = new URL(req.url, `http://localhost:${PORT}`);
      const ext = req.headers['sec-websocket-extensions'] || '';
      const proto = req.headers['sec-websocket-protocol'] || '';
      const upg = req.headers['upgrade'] || '';
      if (u.pathname === '/api/pvd/ws') {
        wssPvd.handleUpgrade(req, socket, head, (ws) => wssPvd.emit('connection', ws, req));
        return;
      }
      if (u.pathname === '/api/video-donation/admin/ws') {
        wssPvdAdmin.handleUpgrade(req, socket, head, (ws) => wssPvdAdmin.emit('connection', ws, req));
        return;
      }
      if (u.pathname === '/api/drawing-donation/ws') {
        wssDrawingOverlay.handleUpgrade(req, socket, head, (ws) => wssDrawingOverlay.emit('connection', ws, req));
        return;
      }
      if (u.pathname === '/api/drawing-donation/admin/ws') {
        wssDrawingAdmin.handleUpgrade(req, socket, head, (ws) => wssDrawingAdmin.emit('connection', ws, req));
        return;
      }
      if (u.pathname === '/api/roulette/ws') {
        wssRoulette.handleUpgrade(req, socket, head, (ws) => wssRoulette.emit('connection', ws, req));
        return;
      }
      if (u.pathname === '/api/prediction/ws') {
        wssPrediction.handleUpgrade(req, socket, head, (ws) => wssPrediction.emit('connection', ws, req));
        return;
      }
      if (u.pathname === '/api/fx/ws') {
        wssFx.handleUpgrade(req, socket, head, (ws) => wssFx.emit('connection', ws, req));
        return;
      }
      if (u.pathname === '/api/desktop/ws') {
        wssDesktop.handleUpgrade(req, socket, head, (ws) => wssDesktop.emit('connection', ws, req));
        return;
      }
      if (u.pathname === '/api/automations/local-agent/ws') {
        wssAutomationLocalAgent.handleUpgrade(req, socket, head, (ws) => wssAutomationLocalAgent.emit('connection', ws, req));
        return;
      }
      if (u.pathname === '/api/warudo/ws') {
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
        return;
      }
      // Unknown path: destroy to avoid Express 404 on upgrade requests
      try { socket.destroy(); } catch { }
    } catch (e) {
      try { socket.destroy(); } catch { }
    }
  });
} catch { }
wss.on('connection', async (ws, req) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const token = String(url.searchParams.get('token') || '');
    const pid = await getOwnerPidForApiKey(token);
    if (!pid) {
      try { ws.close(1008, 'Invalid token'); } catch { }
      return;
    }
    // Register socket
    let set = pidSockets.get(pid);
    if (!set) { set = new Set(); pidSockets.set(pid, set); }
    set.add(ws);
    // Heartbeat (optional): mark used on connect
    try { await touchApiKeyLastUsed(token); } catch { }

    // If Redis is enabled, subscribe to pid channel for cross-instance events
    if (redisEnabled && redisPkg && !redisSubscribers.has(pid)) {
      try {
        const sub = redisPkg.createClient({ url: REDIS_URL });
        sub.on('error', (e) => console.warn('[Redis] sub error', e?.message || e));
        await sub.connect();
        await sub.subscribe(`warudo:pid:${pid}`, (message) => {
          try {
            const data = JSON.parse(message);
            if (data && data.sender && data.sender === INSTANCE_ID) return; // ignore self
            const payload = data?.payload || null;
            if (!payload) return;
            // Enqueue locally to satisfy long-poll and also WS broadcast
            enqueueWarudoEvent(pid, payload);
          } catch { }
        });
        redisSubscribers.set(pid, sub);
      } catch (e) {
        console.warn('[Redis] subscribe error', e?.message || e);
      }
    }

    ws.on('close', () => {
      const s = pidSockets.get(pid);
      if (s) { s.delete(ws); if (s.size === 0) pidSockets.delete(pid); }
      // If no sockets remain for this pid, unsubscribe and close Redis sub
      if (redisEnabled && pidSockets.get(pid) == null) {
        const sub = redisSubscribers.get(pid);
        if (sub) {
          redisSubscribers.delete(pid);
          try { sub.unsubscribe(`warudo:pid:${pid}`); } catch { }
          try { sub.quit(); } catch { }
        }
      }
    });
    ws.on('error', () => {
      try { ws.close(); } catch { }
    });
  } catch (e) {
    try { ws.close(); } catch { }
  }
});

async function broadcastRouletteResult(token) {
  try {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      console.error('[Roulette Broadcast] Invalid token provided');
      return { success: false, error: 'Invalid token' };
    }

    const channelId = await getChannelIdFromToken(token, 'roulette');

    if (!channelId) {
      console.error(`[Roulette Broadcast] Failed to extract channel ID from token: ${token.substring(0, 8)}...`);
      return { success: false, error: 'Channel ID not found' };
    }

    if (typeof channelId !== 'string' || channelId.trim().length === 0) {
      console.error(`[Roulette Broadcast] Invalid channel ID format: ${channelId}`);
      return { success: false, error: 'Invalid channel ID format' };
    }

    const row = await getRouletteSessionByToken(token);
    if (!row) {
      console.error(`[Roulette Broadcast] No roulette session found for token: ${token.substring(0, 8)}...`);
      return { success: false, error: 'Roulette session not found' };
    }

    let sid = rouletteTokenToSid.get(token) || null;
    if (!sid) {
      //
      sid = await findSidByRouletteToken(token);
      if (sid) {
        rouletteTokenToSid.set(token, sid);
        console.log(`[Roulette Broadcast] SID cached for token: ${token.substring(0, 8)}... -> ${sid}`);
      } else {
        console.warn(`[Roulette Broadcast] SID not found for token: ${token.substring(0, 8)}...`);
      }
    }

    if (sid) {
      try {
        const channelContext = await getChannelContext(sid);
        if (channelContext && channelContext.channelId !== channelId) {
          console.error(`[Roulette Broadcast] Channel ID mismatch: token maps to ${channelId}, but SID maps to ${channelContext.channelId}`);
          return { success: false, error: 'Channel ID mismatch' };
        }
      } catch (contextError) {
        console.warn(`[Roulette Broadcast] Could not verify SID-channel consistency: ${contextError.message}`);
      }
    }

    let theme = null;
    let items = null;
    try {
      if (sid) {
        const settings = await getBotSettings(sid) || {};
        const defs = getRouletteDefsFromSettings(settings);
        const def = defs.find(d => String(d.name).toLowerCase() === String(row.roulette_name || '').toLowerCase());
        if (def) {
          theme = def.theme || null;
          items = Array.isArray(def.items) ? def.items.map(it => String(it.label || '')).filter(Boolean) : null;
        }
      }
    } catch (error) {
      console.warn(`[Roulette Broadcast] Failed to resolve theme/items for token: ${token.substring(0, 8)}...`, error.message);
    }

    const meta = rouletteTokenLastBatch.get(token) || null;
    const message = {
      type: 'roulette',
      token,
      name: row.roulette_name || null,
      username: row.username || null,
      value: row.result_value ?? null,
      label: row.result_label || null,
      createdAt: row.created_at || null,
      theme,
      items,
      batchId: meta?.batchId || null,
      batchCount: meta?.batchCount || 1
    };

    let result;
    try {
      result = await broadcastToChannel(channelId, 'roulette', message, token);
    } catch (broadcastError) {
      console.error(`[Roulette Broadcast] Broadcast failed for channel ${channelId}:`, broadcastError.message);

      const errorInfo = {
        success: false,
        error: broadcastError.code || 'BROADCAST_FAILED',
        errorMessage: broadcastError.message,
        channelId,
        token: token.substring(0, 8) + '...',
        timestamp: new Date().toISOString()
      };

      if (broadcastError.details) {
        errorInfo.details = broadcastError.details;
      }

      if (broadcastError.code === 'TOKEN_CHANNEL_MISMATCH') {
        console.error(`[Roulette Broadcast] Critical: Token-channel mapping inconsistency detected for token ${token.substring(0, 8)}...`);

        rouletteTokenToSid.delete(token);

        errorInfo.criticalError = true;
        errorInfo.action = 'Token mapping cleared due to inconsistency';
      }

      return errorInfo;
    }

    if (!result || typeof result !== 'object') {
      const errorInfo = {
        success: false,
        error: 'INVALID_BROADCAST_RESULT',
        errorMessage: 'Invalid broadcast result format',
        channelId,
        token: token.substring(0, 8) + '...',
        result: result
      };
      console.error(`[Roulette Broadcast] Invalid broadcast result for channel ${channelId}:`, result);
      return errorInfo;
    }

    if (result.error) {
      const errorInfo = {
        success: false,
        error: result.error,
        errorMessage: result.errorMessage || 'Broadcast operation failed',
        channelId,
        token: token.substring(0, 8) + '...',
        broadcastDetails: result
      };

      console.error(`[Roulette Broadcast] Broadcast operation failed for channel ${channelId}:`, result.error);

      if (result.error === 'TOKEN_CHANNEL_MISMATCH') {
        console.error(`[Roulette Broadcast] Token-channel mismatch detected, clearing cached mapping`);
        rouletteTokenToSid.delete(token);
        errorInfo.action = 'Token mapping cleared';
      } else if (result.error === 'BROADCAST_COMPLETE_FAILURE') {
        console.error(`[Roulette Broadcast] Complete broadcast failure - all connections failed`);
        errorInfo.severity = 'HIGH';
      }

      return errorInfo;
    }

    if (result.success > 0) {
      console.log(`[Roulette Broadcast] Successfully sent to ${result.success}/${result.total} connections in channel ${channelId} for specific token: ${token.substring(0, 8)}...`);

      //
      if (typeof updateBroadcastStats === 'function') {
        try {
          updateBroadcastStats(channelId, 'roulette', result.success, result.failed);
        } catch (statsError) {
          console.warn(`[Roulette Broadcast] Failed to update stats: ${statsError.message}`);
        }
      }

      if (result.failed > 0) {
        console.warn(`[Roulette Broadcast] Partial failure: ${result.failed}/${result.total} connections failed in channel ${channelId}`);

        if (result.warning === 'HIGH_FAILURE_RATE') {
          console.warn(`[Roulette Broadcast] High failure rate detected in channel ${channelId} - connection quality may be poor`);
        }

        if (result.failedConnections && result.failedConnections.length > 0) {
          console.warn(`[Roulette Broadcast] Failed connection details:`, result.failedConnections.slice(0, 5));
        }
      }

      if (result.deadConnectionsRemoved > 0) {
        console.log(`[Roulette Broadcast] Cleaned up ${result.deadConnectionsRemoved} dead connections in channel ${channelId}`);
      }

    } else {
      console.warn(`[Roulette Broadcast] No active connections found in channel ${channelId} for token: ${token.substring(0, 8)}... (total checked: ${result.total})`);

      if (result.total === 0) {
        console.info(`[Roulette Broadcast] Channel ${channelId} has no registered roulette connections`);

        const warningInfo = {
          success: false,
          warning: 'NO_CONNECTIONS',
          message: `No active roulette connections in channel ${channelId}`,
          channelId,
          token: token.substring(0, 8) + '...',
          suggestion: 'Check if roulette viewers are properly connected'
        };

        return warningInfo;

      } else if (result.failed === result.total) {
        console.warn(`[Roulette Broadcast] All ${result.total} connections in channel ${channelId} failed to receive message`);

        const errorInfo = {
          success: false,
          error: 'ALL_CONNECTIONS_FAILED',
          message: `All ${result.total} connections failed in channel ${channelId}`,
          channelId,
          token: token.substring(0, 8) + '...',
          totalConnections: result.total,
          failedConnections: result.failedConnections || []
        };

        return errorInfo;
      }
    }

    return;

  } catch (error) {
    console.error('[Roulette Broadcast] Unexpected error:', error?.message || error);

    const errorInfo = {
      success: false,
      error: 'UNEXPECTED_ERROR',
      errorMessage: error?.message || 'Unknown error occurred',
      channelId: channelId || null,
      token: token ? token.substring(0, 8) + '...' : null,
      timestamp: new Date().toISOString(),
      stack: error?.stack || null
    };

    return errorInfo;
  }
}

// Normalize roulette defs stored under bot settings
function getRouletteDefsFromSettings(settings) {
  try {
    const defs = Array.isArray(settings?.rouletteDefs) ? settings.rouletteDefs : [];
    return defs
      .map(d => ({
        name: String(d?.name || '').trim() || '룰렛',
        type: (d?.type === 'probability' ? 'probability' : 'items'),
        items: Array.isArray(d?.items) ? d.items.map(it => ({
          label: String(it?.label || '').trim(),
          value: it?.value ?? null,
          weight: Number.isFinite(Number(it?.weight)) ? Number(it.weight) : undefined,
          probability: Number.isFinite(Number(it?.probability)) ? Number(it.probability) : undefined,
        })).filter(x => x.label) : [],
        theme: (() => {
          const t = String(d?.theme || '').toLowerCase();
          const aliases = new Map([
            ['classic', 'studio'],
            ['fire', 'solar'],
            ['ice', 'ocean'],
            ['pastel', 'prism'],
            ['forest', 'aurora'],
            ['midnight', 'mono'],
            ['sunset', 'solar'],
          ]);
          const allowed = new Set(['studio', 'prism', 'aurora', 'velvet', 'mono', 'deco', 'crystal', 'ink', 'nova', 'ceramic', 'arcade', 'sakura', 'ocean', 'solar', 'cyber', 'gold', 'classic', 'fire', 'ice', 'pastel', 'forest', 'midnight', 'sunset']);
          const layouts = new Set(['reel', 'wheel']);
          const parts = t.split(/[:_\-\s]+/).filter(Boolean);
          const rawTheme = parts.find((part) => allowed.has(part));
          const theme = aliases.get(rawTheme) || rawTheme;
          const layout = parts.find((part) => layouts.has(part));
          return theme ? (layout ? `${layout}:${theme}` : theme) : undefined;
        })(),
      }))
      .filter(d => d.items.length > 0);
  } catch {
    return [];
  }
}
