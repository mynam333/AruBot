import express from 'express';
import path from 'path';
import axios from 'axios';
import https from 'https';
import dns from 'dns';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { initDb, upsertTokens, getTokens, updateTokens, revokeTokens, getBotSettings, setBotSettings, getBotStats, updateBotStats, getBotRules, upsertBotRule, deleteBotRule, markLiveDay, recordAttendanceAndGetStreak, migrateSidToUserPid, upsertSession, getSessionUserId, getAnyTokens, listChannelPoints, listViewerPointBalancesForUserIds, setChannelPoints, incrChannelPoints, getChannelPoints, deleteChannelPoints, clearAllChannelPoints, bulkUpsertChannelPoints, getUserAttendanceTotalDays, issueApiKey, revokeApiKey, getOwnerPidForApiKey, touchApiKeyLastUsed, getActiveApiKeyForOwner, revokeAllApiKeysForOwner, findSidByViewerToken, findSidByRouletteToken, getOrCreateViewerTokenSupabase, rotateViewerTokenSupabase, insertRouletteSession, getRouletteSessionByToken, listRouletteSessionsByToken, listAllSidsWithTokens, getLiveSessionFromDB, upsertLiveSessionToDB, updateLiveSessionLastUpdate, getActiveLiveSessionsFromDB, deleteOldLiveSessionsFromDB, initializeLiveSessionsOnStartup, cleanupOldSessions, upsertPlatformIdentity, listPlatformAccounts, updatePlatformAccountProfile, upsertPlatformTokens, getPlatformTokens, deletePlatformTokens, deletePlatformAccount, listPredictionsForSid, getPredictionForSid, getActivePredictionForChannel, createPrediction, lockPredictionForSid, cancelPredictionForSid, settlePredictionForSid, placePredictionBet } from './supabase.js';
import { createPlatformProfileService } from './platform-profiles.js';
import { WebSocketServer, WebSocket } from 'ws';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || process.env.SERVER_PORT || 3001;
const INSTANCE_ID = 'inst_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(36);
const PROCESS_ROLE = process.env.ARUBOT_PROCESS_ROLE || 'api-runtime';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://arubot.yuaru.com';
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || 'https://arubotapi.yuaru.com';
const SERVER_STARTED_AT = new Date().toISOString();
const ALLOWED_ORIGINS = [
  FRONTEND_ORIGIN,
  BACKEND_ORIGIN,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
].filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow same-origin/non-browser (e.g., OBS)
    try {
      const u = new URL(origin);
      const o = u.origin;
      // exact allowlist
      if (ALLOWED_ORIGINS.includes(o)) return cb(null, true);
      if (
        ['localhost', '127.0.0.1', '::1'].includes(u.hostname) &&
        Number(u.port) >= 3000 &&
        Number(u.port) < 3100
      ) {
        return cb(null, true);
      }
      // allow deployed yuaru service subdomains over https
      if (u.protocol === 'https:' && (u.hostname.endsWith('.yuaru.kr') || u.hostname.endsWith('.yuaru.com'))) return cb(null, true);
    } catch { }
    return cb(null, false);
  },
  credentials: true,
};

app.use(cors(corsOptions));
// Explicit preflight support for all routes
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// Serve static files (SFX, etc.) with CORS
app.use('/files', cors(), express.static(path.join(path.dirname(new URL(import.meta.url).pathname), 'files')));

// =============================
// =============================
const sessionContextCache = new Map(); // sidToken -> { sid, channelId, userId, lastActivity, sessionKey }
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
const pvdTokenToSid = new Map(); // token -> sid (in-memory reverse index)

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

async function sendChatByPost(sid, chatPost, message, opts = {}) {
  const text = String(message || '').trim();
  if (!text) return null;
  const provider = String(chatPost?.provider || 'chzzk').toLowerCase();
  if (provider === 'cime') {
    const ownerUserId = chatPost?.ownerUserId || String(sid || '').replace(/^user:/, '');
    return sendCimeChat(ownerUserId, text.slice(0, 100));
  }

  let sessionKey = chatPost?.sessionKey || null;
  let token = chatPost?.accessToken || null;
  if (!sessionKey) {
    const entry = sessionStore.get(sid) || await ensureSession(sid);
    sessionKey = entry?.sessionKey || null;
  }
  if (!token) token = await getValidAccessToken(sid);
  if (!sessionKey || !token) throw new Error('missing chat credentials');

  const url = `${OPENAPI_BASE}/open/v1/chats/send`;
  const r = await axios.post(url, { message: text.slice(0, 100) }, {
    params: { sessionKey },
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: opts.timeout || 5000
  });
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
    try {
      const s = await getBotSettings(sid) || {};
      if (!s.videoDonationViewerToken || s.videoDonationViewerToken !== token) return res.status(404).json({ error: 'token not found' });
    } catch { }
    const q = getVideoQueue(sid);
    if (!q[0]) return res.json({ ok: true });
    const op = String(req.body?.op || '').toLowerCase();
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

    // Broadcast control to all viewers
    const message = { type: 'control', op, atSec: Math.floor(atSec), paused: state.paused === true, serverNow: Date.now() };

    try {
      const channelResult = await broadcastToChannelBySid(sid, 'pvd', message);
      console.log(`[PVD Control] Broadcast result: ${channelResult.success} connections`);
    } catch (error) {
      console.error('[PVD Control] Channel broadcast error:', error);
    }

    const set = pvdSidSockets.get(sid);
    const payload = JSON.stringify(message);
    if (set && set.size) {
      for (const ws of Array.from(set)) {
        try { if (ws.readyState === 1) ws.send(payload, { compress: false }); } catch { }
      }
    }

    return res.json({ ok: true });
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
app.get('/api/macros/debug', async (req, res) => {
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
app.get('/api/macros/performance/system', async (req, res) => {
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
app.post('/api/macros/cleanup', async (req, res) => {
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

app.get('/api/attendance/performance', async (req, res) => {
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

app.post('/api/attendance/validate-sessions', async (req, res) => {
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

app.get('/api/memory/report', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) return res.status(401).json({ error: 'Login required' });

    const report = memoryManager.getMemoryReport();
    return res.json(report);
  } catch (error) {
    return res.status(500).json({ error: 'failed', message: error.message });
  }
});

app.post('/api/memory/cleanup', async (req, res) => {
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

app.get('/api/memory/sessions', async (req, res) => {
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

app.get('/api/memory/channel-cache', async (req, res) => {
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

app.get('/api/memory/connection-pool', async (req, res) => {
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

app.post('/api/memory/channel-cache/cleanup', async (req, res) => {
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
app.get('/api/memory/resource-stats', async (req, res) => {
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
app.post('/api/memory/resource-cleanup', async (req, res) => {
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

app.get('/api/memory/usage-detail', async (req, res) => {
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

app.get('/api/debug/token-validation', async (req, res) => {
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
  } catch (e) { console.error(e) }
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
// Uses the same logic as isLiveAllowedForSid but optimized for macro system.
// Policy:
// - If settings.onlyWhenLive is falsy (default), treat as live.
// - If settings.onlyWhenLive is true, check actual stream status via Chzzk API.
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

    // onlyWhenLive is true: check actual stream status
    const channelUids = Array.isArray(settings.channelUids)
      ? settings.channelUids.map(String).filter(Boolean)
      : (typeof settings.channelUidsText === 'string'
        ? settings.channelUidsText.split(',').map(s => s.trim()).filter(Boolean)
        : []);

    if (!channelUids.length) {
      // No channels configured, can't determine live status
      return false;
    }

    // Check if any configured channel is live
    for (const uid of channelUids) {
      try {
        const r = await axiosGetWithRetry(`https://api.chzzk.naver.com/service/v2/channels/${encodeURIComponent(uid)}/live-detail`);
        const content = r?.data?.content || r?.data || {};
        const status = String(content?.status || '').toLowerCase();
        if (status === 'open') {
          return true; // Found at least one live channel
        }
      } catch (e) {
        console.warn(`[isSidLive] API check failed for channel ${uid}:`, e?.code || e?.message || e);
        // Continue checking other channels
      }
    }

    // No live channels found
    return false;

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
    const settings = await getBotSettings(sid) || {};
    
    const channelUids = Array.isArray(settings.channelUids)
      ? settings.channelUids.map(String).filter(Boolean)
      : (typeof settings.channelUidsText === 'string'
        ? settings.channelUidsText.split(',').map(s => s.trim()).filter(Boolean)
        : []);

    if (!channelUids.length) {
      return false;
    }

    for (const uid of channelUids) {
      try {
        const r = await axiosGetWithRetry(`https://api.chzzk.naver.com/service/v2/channels/${encodeURIComponent(uid)}/live-detail`);
        const content = r?.data?.content || r?.data || {};
        const status = String(content?.status || '').toLowerCase();
        if (status === 'open') {
          return true;
        }
      } catch (e) {
        console.warn(`[isSidActuallyLive] API check failed for channel ${uid}:`, e?.code || e?.message || e);
      }
    }

    return false;

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

setInterval(async () => {
  try {
    // Iterate active sessions only
    for (const [sid, entry] of sessionStore.entries()) {

      const live = await getMacroLiveCached(sid);
      if (!live) continue; // Only run while actually live (regardless of onlyWhenLive setting)
      const macros = await getMacrosCached(sid);
      if (!macros.length) continue;
      if (!entry.sessionKey) continue; // need session to post chat
      let accessToken = null;
      try { accessToken = await getValidAccessToken(sid); } catch { accessToken = null; }
      if (!accessToken) continue;

      const url = `${OPENAPI_BASE}/open/v1/chats/send`;

      // Process macros without detailed logging

      // Process each macro independently using the new timer manager
      let macrosSentCount = 0;
      for (const m of macros) {
        // Check if this specific macro should be sent based on its individual timer
        if (macroTimerManager.shouldSendMacro(sid, m.id, m.intervalSec)) {
          const msg = String(m.message || '').slice(0, 1000);
          let sendSuccess = false;
          let errorDetails = null;
          const sendStartTime = Date.now();

          try {
            const response = await axios.post(url, { message: msg }, {
              params: { sessionKey: entry.sessionKey },
              headers: { Authorization: `Bearer ${accessToken}` },
              timeout: 5000 // 5 second timeout to prevent hanging
            });

            // Check response status for additional validation
            if (response.status >= 200 && response.status < 300) {
              sendSuccess = true;
              const responseTime = Date.now() - sendStartTime;

              // Mark macro as sent silently
              macroTimerManager.markMacroSent(sid, m.id);
            } else {
              throw new Error(`Unexpected response status: ${response.status}`);
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
            macroTimerManager.recordFailure(sid, m.id, errorDetails);

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
    return res.json({ rules });
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
    if (idx < 0) {
      incoming.id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      incoming.enabled = incoming.enabled !== false;
      rules.push(incoming);
    } else {
      rules[idx] = { ...rules[idx], ...incoming };
    }
    const next = { ...s, donationRules: rules };
    await setBotSettings(sid, next);
    return res.json({ ok: true, rule: incoming });
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
app.post('/api/chzzk/send', async (req, res) => {
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
      broadcastPvdStart(sid);
    } else {
      // Head same: still inform clients to update tail order
      const set = pvdSidSockets.get(sid);
      if (set && set.size) {
        const msg = JSON.stringify({ type: 'start', item: reordered[0] || null, queue: reordered, startedAt: pvdPlaybackState.get(sid)?.baseStartMs || null, paused: pvdPlaybackState.get(sid)?.paused || false });
        for (const ws of Array.from(set)) {
          try { if (ws.readyState === 1) ws.send(msg, { compress: false }); } catch { }
        }
      }
    }
    try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
    scheduleNextPvdAutoPop(sid);
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
      broadcastPvdStart(sid);
      scheduleNextPvdAutoPop(sid);
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
        await incrChannelPoints(uid, String(item.userId), item.username ? String(item.username) : null, Number(item.cost));
      }
    } catch (e) {
      console.warn('[pvd:delete-refund] refund failed', e?.message || e);
    }
    // Remove from queue
    q.splice(idx, 1);
    if (removingHead) {
      try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
      broadcastPvdStart(sid);
      scheduleNextPvdAutoPop(sid);
    } else {
      // Inform clients of tail change
      const set = pvdSidSockets.get(sid);
      if (set && set.size) {
        const msg = JSON.stringify({ type: 'start', item: q[0] || null, queue: q, startedAt: pvdPlaybackState.get(sid)?.baseStartMs || null, paused: pvdPlaybackState.get(sid)?.paused || false });
        for (const ws of Array.from(set)) {
          try { if (ws.readyState === 1) ws.send(msg, { compress: false }); } catch { }
        }
      }
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

// Playback state per sid for sync.
// baseStartMs is the wall-clock time when the current item started at item.startSec.
const pvdPlaybackState = new Map(); // sid -> { baseStartMs: number, paused: boolean, pausedAtSec: number|null }

function getPvdItemStartSec(item) {
  return Math.max(0, Math.floor(Number(item?.startSec || 0)));
}

function createPvdPlaybackState(item) {
  return { baseStartMs: Date.now(), paused: false, pausedAtSec: null };
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
  // Compute remaining based on current position
  const elapsedSec = getCurrentPvdElapsedSec(sid);
  const total = Math.max(1, Number(item.durationSec || 0));
  const remaining = Math.max(0.5, total - elapsedSec);
  const ms = Math.max(500, remaining * 1000);
  const timer = setTimeout(() => {
    try {
      // Confirm head unchanged and not paused before popping
      const head = getVideoQueue(sid)[0];
      const st = pvdPlaybackState.get(sid);
      if (!head || (st && st.paused)) return; // safety check
      // Extra guard: if we haven't really reached end, delay
      const curElapsed = getCurrentPvdElapsedSec(sid);
      if (curElapsed < Math.max(1, Number(head.durationSec || 0)) - 0.5) {
        return scheduleNextPvdAutoPop(sid);
      }
      // pop current
      getVideoQueue(sid).shift();
      broadcastPvdStart(sid);
      scheduleNextPvdAutoPop(sid);
    } catch (e) {
      console.warn('[pvd:autoPop] failed', e?.message || e);
    }
  }, ms);
  videoDonationTimers.set(sid, timer);
}

async function broadcastPvdStart(sid) {
  try {
    const q = getVideoQueue(sid);

    // Rebase playback state when a new head starts
    if (q[0]) {
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

    // Reschedule timer for new head
    try { clearTimeout(videoDonationTimers.get(sid)); } catch { }
    scheduleNextPvdAutoPop(sid);

  } catch (error) {
    console.error('[PVD Broadcast] Error in broadcastPvdStart:', error);

    const set = pvdSidSockets.get(sid);
    if (set && set.size > 0) {
      const q = getVideoQueue(sid);
      const msg = JSON.stringify({
        type: 'start',
        item: q[0] || null,
        queue: q,
        startedAt: q[0] ? pvdPlaybackState.get(sid)?.baseStartMs || null : null,
        paused: q[0] ? false : null
      });
      for (const ws of Array.from(set)) {
        try { if (ws.readyState === 1) { ws.send(msg, { compress: false }); } } catch { }
      }
    }
  }
}

// Diagnostics: check active server instance/version
app.get('/api/version', (req, res) => {
  res.json({
    ok: true,
    instanceId: INSTANCE_ID,
    role: PROCESS_ROLE,
    pid: process.pid,
    startedAt: SERVER_STARTED_AT,
    wsPvdPerMessageDeflate: false,
    node: process.version
  });
});

app.get('/api/health', (req, res) => {
  const memory = process.memoryUsage();
  const poolStatus = connectionPool.getPoolStatus();
  res.json({
    ok: true,
    instanceId: INSTANCE_ID,
    role: PROCESS_ROLE,
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    startedAt: SERVER_STARTED_AT,
    node: process.version,
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
    },
    websocket: {
      pvdClients: Array.from(pvdSidSockets.values()).reduce((sum, sockets) => sum + sockets.size, 0),
      channelPoolConnections: poolStatus.totalConnections,
      channelPoolChannels: poolStatus.totalChannels,
      desktopClients: Array.from(desktopPidSockets.values()).reduce((sum, sockets) => sum + sockets.size, 0),
      warudoClients: Array.from(pidSockets.values()).reduce((sum, sockets) => sum + sockets.size, 0),
    },
  });
});

// Send a command to desktop clients via API key
// POST /api/desktop/command
// Authorization: Bearer <API_KEY>  OR  body.token / query.token
app.post('/api/desktop/command', async (req, res) => {
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
    return res.json({ pointsPerSecond: pps, acceptEnabled: enabled, maxDurationSec: maxDur, perUserLimit });
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
    const q = getVideoQueue(sid);
    const popped = q.shift() || null;
    // Refund on error cause
    if (popped && cause === 'error') {
      try {
        const uid = await resolveStreamerUidForSid(sid);
        if (uid && popped.userId && popped.cost) {
          await incrChannelPoints(uid, String(popped.userId), popped.username ? String(popped.username) : null, Number(popped.cost));
        }
      } catch (e) { console.warn('[pvd:refund] failed (token)', e?.message || e); }
    }
    // Broadcast next (or null) to all viewers
    if (popped) {
      broadcastPvdStart(sid);
      scheduleNextPvdAutoPop(sid);
    }
    return res.json({ item: popped });
  } catch (e) {
    return res.status(500).json({ error: 'failed' });
  }
});

// Resolve YouTube title/duration for a given url or id (helper for clients)
app.get('/api/video-donation/resolve-title', async (req, res) => {
  try {
    const q = String(req.query?.url || req.query?.id || req.query?.q || '');
    if (!q) return res.status(400).json({ error: 'url, id or q required' });
    let id = extractYouTubeId(q) || '';
    if (!id) {
      try { id = await searchYouTubeVideoIdByQuery(q); } catch { }
    }
    if (!id) return res.status(404).json({ error: 'not_found' });
    const info = await fetchYouTubeInfo(id);
    return res.json({ title: info?.title || null, durationSec: Number.isFinite(info?.durationSec) ? Number(info.durationSec) : null });
  } catch (e) {
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
    const settings = await getBotSettings(sid) || {};
    const next = { ...settings, videoDonationPointsPerSecond: pps, videoDonationAcceptEnabled: enabled, videoDonationMaxDurationSec: maxDur, videoDonationPerUserQueueLimit: perUserLimit };
    await setBotSettings(sid, next);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[pvd:settings:post] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to save settings' });
  }
});

// POST request: enqueue a video donation request, deduct points
// body: { videoUrl, title?, startSec?, playSec?, requesterUserId, requesterUsername }
app.post('/api/video-donation/request', async (req, res) => {
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
    const looksDirect = /youtu/i.test(input) || /^[A-Za-z0-9_-]{11}$/.test(input);
    let videoId = looksDirect ? extractYouTubeId(input) : null;
    // If not a URL/id, force search query and pick best match
    if (!videoId && input) {
      try { videoId = await searchYouTubeVideoIdByQuery(input); } catch { }
    }
    if (!videoId) return res.status(400).json({ error: 'No video found for the given input' });
    // Resolve title and duration via YouTube Data API v3 (if available), fallback to oEmbed for title
    let ytTitle = null;
    let ytDuration = null;
    try {
      const info = await fetchYouTubeInfo(videoId);
      ytTitle = info.title || null;
      ytDuration = Number.isFinite(info.durationSec) ? Number(info.durationSec) : null;
    } catch { }
    if (!ytTitle && !title) {
      try {
        const enc = encodeURIComponent(videoUrl);
        const r = await axios.get(`https://www.youtube.com/oembed?url=${enc}&format=json`, { timeout: 3000 });
        ytTitle = r?.data?.title || null;
      } catch { }
    }
    const start = Math.max(0, Number(startSec || 0) || 0);
    const play = Number.isFinite(Number(playSec)) && Number(playSec) > 0 ? Math.floor(Number(playSec)) : null;
    const baseDur = play != null ? play : (ytDuration != null ? ytDuration : maxDur);
    const dur = Math.max(1, Math.min(maxDur, baseDur));
    const cost = Math.ceil(pps * dur);

    // Deduct points
    const uid = await resolveStreamerUidForSid(sid);
    if (!uid) return res.status(400).json({ error: 'No channel UID' });
    const userId = String(requesterUserId || '').trim();
    const username = requesterUsername ? String(requesterUsername) : null;
    if (!userId) return res.status(400).json({ error: 'requesterUserId required' });
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
    const item = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      videoId,
      title: title || ytTitle || null,
      durationSec: dur,
      startSec: start,
      cost,
      userId,
      username: username || null,
      status: 'queued'
    };
    q.push(item);
    // If this is the first item, broadcast start & schedule auto pop
    if (q.length === 1) {
      broadcastPvdStart(sid);
      scheduleNextPvdAutoPop(sid);
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

    try {
      const settings = await getBotSettings(sid) || {};
      if (!settings.videoDonationViewerToken || settings.videoDonationViewerToken !== token) {
        return res.status(404).json({ error: 'token not found' });
      }
    } catch { }

    const q = getVideoQueue(sid);
    const state = pvdPlaybackState.get(sid) || null;
    res.set('Cache-Control', 'no-store, max-age=0');
    return res.json({
      item: q[0] || null,
      queue: q,
      startedAt: state?.baseStartMs || null,
      paused: state?.paused === true,
      atSec: getCurrentAtSec(sid),
      elapsedSec: getCurrentPvdElapsedSec(sid),
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
    const q = getVideoQueue(sid);
    const popped = q.shift() || null;
    // Refund on error cause
    if (popped && cause === 'error') {
      try {
        const uid = await resolveStreamerUidForSid(sid);
        if (uid && popped.userId && popped.cost) {
          await incrChannelPoints(uid, String(popped.userId), popped.username ? String(popped.username) : null, Number(popped.cost));
        }
      } catch (e) { console.warn('[pvd:refund] failed', e?.message || e); }
    }
    // if popping current, schedule next and broadcast
    if (popped) {
      broadcastPvdStart(sid);
      scheduleNextPvdAutoPop(sid);
    }
    return res.json({ item: popped });
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

  let token;
  try {
    token = await generateChannelRouletteToken(channelContext.channelId);

    registerTokenChannelMapping(token, channelContext.channelId);

    rouletteTokenToSid.set(token, sid);

    console.log(`[Roulette] Generated channel token for ${channelContext.channelId}: ${token.substring(0, 16)}...`);

  } catch (error) {
    console.error('[Roulette] Failed to generate channel token, falling back to legacy method:', error);

    token = typeof settings.rouletteViewerToken === 'string' && settings.rouletteViewerToken.trim()
      ? String(settings.rouletteViewerToken).trim()
      : '';
    if (!token) {
      token = 'rlt_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
      try {
        const next = { ...settings, rouletteViewerToken: token };
        await setBotSettings(sid, next);
      } catch { }
    }
    try { rouletteTokenToSid.set(token, sid); } catch { }
  }

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

  if (picked.value && typeof picked.value === 'string' && picked.value.trim()) {
    try {
      console.log(`[Roulette] Executing command from result: ${picked.value} for user: ${username}`);
      await executeRouletteResultCommand(sid, picked.value.trim(), userId, username, opts?.chatPost || null);
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
    const isCimeChatPost = String(chatPost?.provider || '').toLowerCase() === 'cime';
    if (!isCimeChatPost && (!entry || !entry.sessionKey)) {
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
              const accessToken = isCimeChatPost ? null : await getValidAccessToken(sid);
              const base = {
                name,
                userId: String(userId || ''),
                username: String(username || ''),
                chatPost: isCimeChatPost
                  ? makeCimeChatPost(chatPost.ownerUserId, username, { suppressResultChat: false })
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
          if (!ownerPid && isCimeChatPost) ownerPid = sid;

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

      if (responseToSend && String(responseToSend).length > 0) {
        try {
          const finalMsg = '[룰렛 결과] ' + String(responseToSend);
          const post = isCimeChatPost ? chatPost : makeChzzkChatPost(entry.sessionKey, await getValidAccessToken(sid), username);
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
    if (!q[0]) return res.json({ ok: true });
    const op = String(req.body?.op || '').toLowerCase();
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

    // Broadcast control to all viewers
    const message = { type: 'control', op, atSec: Math.floor(atSec), paused: state.paused === true, serverNow: Date.now() };

    try {
      const channelResult = await broadcastToChannelBySid(sid, 'pvd', message);
      console.log(`[PVD Control] Broadcast result: ${channelResult.success} connections`);
    } catch (error) {
      console.error('[PVD Control] Channel broadcast error:', error);
    }

    const set = pvdSidSockets.get(sid);
    const payload = JSON.stringify(message);
    if (set && set.size) {
      for (const ws of Array.from(set)) {
        try { if (ws.readyState === 1) ws.send(payload, { compress: false }); } catch { }
      }
    }

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
  const live = status === 'open' || status === 'OPEN' || status === 'Open';
  const title = content?.liveTitle || content?.title || '';
  const category = content?.liveCategory?.categoryType || content?.categoryType || content?.liveCategoryName || '';
  const viewers = Number(content?.concurrentUserCount || content?.currentViewerCount || 0);
  const openCandidate = content?.openDate || content?.openTime || content?.openedAt || content?.liveStartAt || null;
  const startedAtTs = openCandidate != null && !Number.isNaN(Number(openCandidate)) ? Number(openCandidate) : null;
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
  let channelUids = Array.isArray(settings.channelUids)
    ? settings.channelUids.map(String).filter(Boolean)
    : (typeof settings.channelUidsText === 'string'
      ? settings.channelUidsText.split(',').map(s => s.trim()).filter(Boolean)
      : []);

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
  if (!channelUids.length) return null;
  try {
    const info = await fetchLiveDetail(channelUids[0]);
    liveInfoCache.set(sid, { ts: now, info });
    return info;
  } catch {
    return null;
  }
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
  const liveInfo = await getLiveInfoForSid(sid);
  let out = String(text);
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
      const dt = await findUserFollowedAtForSid(sid, userId);
      out = out.replace(/\{user\.followedAt\}/g, dt || '');
    } catch { }
  }
  // User name placeholders
  if (username && (/{user\.name}/.test(out) || /{user\.username}/.test(out) || /{user\.nickname}/.test(out))) {
    out = out
      .replace(/\{user\.name\}/g, String(username))
      .replace(/\{user\.username\}/g, String(username))
      .replace(/\{user\.nickname\}/g, String(username));
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
      // Resolve streamer channel UID
      let channelUid = null;
      const settings = await getBotSettings(sid) || {};
      const uids = Array.isArray(settings.channelUids) ? settings.channelUids.map(String).filter(Boolean) : [];
      if (uids.length) channelUid = uids[0];
      if (!channelUid) {
        try {
          const accessToken = await getValidAccessToken(sid);
          const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
          const content = me?.data?.content || me?.data || {};
          if (content?.channelId) channelUid = String(content.channelId);
        } catch { }
      }
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
      const followedAt = await findUserFollowedAtForSid(sid, userId); // 'YYYY-MM-DD'
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

async function getChannelUidsForSid(sid) {
  const settings = await getBotSettings(sid) || {};
  const uids = Array.isArray(settings.channelUids) ? settings.channelUids.map(String).filter(Boolean) : [];
  return uids;
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
  return null;
}

// (moved) API Key management endpoints are registered after app initialization

async function findUserFollowedAtForSid(sid, userId) {
  if (!userId) return null;
  const key = `${sid}:${userId}`;
  const cached = userFollowedAtCache.get(key);
  const now = Date.now();
  if (cached && (now - cached.ts) < 10 * 60 * 1000) return cached.date;
  const uids = await getChannelUidsForSid(sid);
  if (!uids.length) return null;
  const channelId = uids[0];
  try {
    const accessToken = await getValidAccessToken(sid);
    // Best-effort: paginate followers list to find the user
    const size = 50;
    for (let page = 1; page <= 10000; page++) {
      let data;
      try {
        const r = await axios.get(`${OPENAPI_BASE}/open/v1/channels/followers`, {
          params: { page, size },
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        data = r?.data?.content || r?.data || {};
      } catch {
        // Fallback to service API
        const r2 = await axios.get(`https://api.chzzk.naver.com/service/v1/channels/${encodeURIComponent(channelId)}/followers`, {
          params: { page, size },
        });
        data = r2?.data?.content || r2?.data || {};
      }
      const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.followers) ? data.followers : []);
      if (!Array.isArray(list) || list.length === 0) break;
      for (const item of list) {
        const fid = String(item?.channelId || item?.user?.userId || '');
        if (fid && fid === String(userId)) {
          const dt = item?.createdDate || item?.createdAt || item?.timestamp || null;
          const iso = dt ? new Date(dt).toISOString().slice(0, 10) : '';
          userFollowedAtCache.set(key, { ts: now, date: iso });
          return iso;
        }
      }
      if (list.length < size) break;
    }
  } catch (e) { console.error(e) }
  return null;
}

async function getUserSubscriptionMonthsForSid(sid, userId) {
  if (!userId) return null;
  const key = `${sid}:${userId}`;
  const cached = userSubMonthsCache.get(key);
  const now = Date.now();
  if (cached && (now - cached.ts) < 10 * 60 * 1000) return cached.months;
  const uids = await getChannelUidsForSid(sid);
  if (!uids.length) return null;
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
      const hasDateMismatch = dbSession.start_date !== cachedSession.startDate;

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
          startDate: dbSession.start_date,
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
// Track active sids seen by the server to enable background live checks
const activeSids = new Map(); // sid -> lastSeenTs

async function isLiveAllowedForSid(sid) {
  try {
    const settings = await getBotSettings(sid) || {};
    const onlyWhenLive = !!settings.onlyWhenLive;
    const channelUids = Array.isArray(settings.channelUids)
      ? settings.channelUids.map(String).filter(Boolean)
      : (typeof settings.channelUidsText === 'string'
        ? settings.channelUidsText.split(',').map(s => s.trim()).filter(Boolean)
        : []);

    if (!onlyWhenLive) return true; // no restriction
    if (!channelUids.length) return false; // restricted but no channels configured

    const cached = liveStatusCache.get(sid);
    const now = Date.now();
    if (cached && (now - cached.ts) < 5 * 60 * 1000) {
      // Keep previous liveSession state; cached does not update transitions
      return !!cached.live;
    }

    // Query channels; if any is OPEN, treat as live
    let anyLive = false;
    let startTs = null;
    for (const uid of channelUids) {
      try {
        const r = await axiosGetWithRetry(`https://api.chzzk.naver.com/service/v2/channels/${encodeURIComponent(uid)}/live-detail`);
        const content = r?.data?.content || r?.data || {};
        const status = String(content?.status || '').toLowerCase();
        if (status === 'open') {
          anyLive = true;
          // Try to extract stream open timestamp (ms) if provided by API
          const candidate = content?.openDate || content?.openTime || content?.openedAt || content?.liveStartAt || null;
          const n = candidate != null ? Number(candidate) : NaN;
          if (!Number.isNaN(n) && n > 0) startTs = n;
          break;
        }
      } catch (e) {
        console.warn('[live-detail] fetch failed for', uid, e?.code || e?.message || e);
      }
    }
    liveStatusCache.set(sid, { ts: now, live: anyLive });

    try {
      const effectiveStartTs = startTs && startTs > 0 ? startTs : now;
      await updateSessionState(sid, anyLive, effectiveStartTs);
    } catch (error) {
      console.error(`[Session] Failed to update session state for ${sid}:`, error);
      const sess = liveSession.get(sid) || { live: false, startDate: undefined, lastUpdate: now };
      if (anyLive) {
        if (!sess.live || !sess.startDate) {
          sess.live = true;
          const startDateKst = getKstDateString(startTs && startTs > 0 ? startTs : undefined);
          sess.startDate = startDateKst;
          sess.sessionStartTime = startTs && startTs > 0 ? startTs : now;
          sess.lastUpdate = now;
          try { await markLiveDay(sid, sess.startDate); } catch { }
        } else {
          sess.lastUpdate = now;
        }
      } else {
        sess.live = false;
        sess.startDate = undefined;
        sess.sessionStartTime = undefined;
        sess.lastUpdate = now;
      }
      liveSession.set(sid, sess);
    }
    return anyLive;
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
const CIME_APP_API_BASE = process.env.CIME_APP_API_BASE || 'https://ci.me/api/app';
const CIME_UNOFFICIAL_PROFILE_URL_TEMPLATE = process.env.CIME_UNOFFICIAL_PROFILE_URL_TEMPLATE || '';
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
      totalPids: pidSockets.size,
      pids: Array.from(pidSockets.keys()).slice(0, 50),
    };
    return res.json(summary);
  } catch (e) {
    return res.status(500).json({ error: 'debug failed' });
  }
});

await initDb();

async function refreshPostgRESTSchema() {
  try {
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

  if (process.env.SUPABASE_URL && process.env.SUPABASE_DB_URL) {
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

  if (process.env.SUPABASE_URL && process.env.SUPABASE_DB_URL) {
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

function getCookieSid(req) {
  const sid = req.cookies.sid;
  return sid;
}

// =============================
// =============================

async function getChannelContext(sid) {
  try {
    if (!sid) return null;

    //
    let userId = null;
    let channelId = null;

    if (sid.startsWith('user:')) {
      userId = sid.slice(5);
      channelId = getChannelIdFromUserId(userId);
    } else {
      userId = sid;
      channelId = getChannelIdFromUserId(userId);
    }

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

    const integrityCheck = await verifyTokenIntegrity(token);
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

    const integrityCheck = await verifyTokenIntegrity(token);
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

    const integrityCheck = await verifyTokenIntegrity(token);
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
async function verifyTokenIntegrity(token) {
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
    }

    if (!match) {
      return { valid: false, error: 'Invalid token pattern' };
    }

    const [, channelHash, timestamp, randomPart] = match;

    const channelId = await getChannelIdFromToken(token, tokenType, false);
    if (!channelId) {
      return { valid: false, error: 'Channel ID not found' };
    }

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

    return { valid: true, channelId };

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

  const cookieOptions = {
    httpOnly: true,
    sameSite: isProduction && secure ? 'none' : 'lax',
    secure,
  };

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
        const url = new URL(returnTo);
        url.searchParams.set('apiKey', key);
        res.writeHead(302, { Location: url.toString() });
        return res.end();
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
      const channelId = getChannelIdFromUserId(userId);

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
      const channelId = getChannelIdFromUserId(userId);
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

    // Last resort: try any token row to resolve userId and attach current cookie sid
    try {
      const anyTok = await getAnyTokens();
      if (anyTok) {
        const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
          headers: { Authorization: `${anyTok.tokenType || 'Bearer'} ${anyTok.accessToken}` }
        });
        const content = me?.data?.content || me?.data || {};
        if (content?.channelId) {
          const uid = String(content.channelId);
          const channelId = getChannelIdFromUserId(uid);

          if (!channelId) {
            console.warn('[SessionBootstrap] Channel ID validation failed for fallback uid:', uid);
            return null;
          }

          try { await upsertSession(sidToken, uid, 30); } catch { }

          const sid = `user:${uid}`;

          const sessionContext = {
            sid,
            channelId,
            userId: uid,
            lastActivity: Date.now(),
            sessionKey: null,
            isolationLevel: 'strict',
            connectionId: `fallback_${Date.now()}_${Math.random().toString(36).slice(2)}`
          };

          const cacheKey = `session:${sidToken}`;
          channelCache.set(channelId, cacheKey, sessionContext, CACHE_TTL);
          console.log(`[SessionBootstrap] Fallback context cached - channelId: ${channelId}, userId: ${uid}`);

          return sid;
        }
      }
    } catch (error) {
      console.error('[SessionBootstrap] Fallback token resolution failed:', error);
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

function collectViewerPointIdentityKeys(ownerUserId, platforms = []) {
  const keys = new Set();
  const add = (value) => {
    const text = String(value || '').trim();
    if (!text) return;
    keys.add(text);
    if (text.startsWith('user:')) keys.add(text.slice(5));
    if (text.startsWith('cime:')) keys.add(text.slice(5));
    if (text.startsWith('chzzk:')) keys.add(text.slice(6));
  };

  add(ownerUserId);
  for (const account of Array.isArray(platforms) ? platforms : []) {
    add(account.platform_user_id);
    add(account.channel_id);
    add(account.channel_handle);
    const metadata = account.metadata || {};
    const raw = metadata.raw || {};
    add(raw.userId);
    add(raw.channelId);
    add(raw.id);
    const publicProfile = metadata.publicProfile || {};
    add(publicProfile.userId);
    add(publicProfile.channelId);
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

// GET /api/auth/chzzk/login -> redirect to CHZZK authorize page
app.get('/api/auth/chzzk/login', (req, res) => {
  try {
    if (!CHZZK_CLIENT_ID || !CHZZK_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Server not configured with CHZZK credentials' });
    }
    // Ensure per-user session id cookie exists
    // Do NOT create random sid pre-login; only set oauth_state here
    const state = crypto.randomBytes(16).toString('hex');
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

app.get('/api/auth/cime/login', (req, res) => {
  try {
    if (!CIME_CLIENT_ID || !CIME_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Server not configured with CIME credentials' });
    }
    const state = crypto.randomBytes(16).toString('hex');
    setOAuthStateCookie(res, 'oauth_state_cime', state);

    const authUrl = new URL(CIME_AUTH_URL);
    authUrl.searchParams.set('clientId', CIME_CLIENT_ID);
    authUrl.searchParams.set('redirectUri', CIME_REDIRECT_URI);
    authUrl.searchParams.set('state', state);
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

    if (error) {
      if (savedState && state && state === savedState) {
        clearManagedCookie(res, 'oauth_state_cime');
      }
      const errorCode = String(error || '');
      const authStatus = errorCode === 'access_denied' ? 'cancelled' : 'error';
      console.warn('[CIME] OAuth authorization did not complete:', {
        error: errorCode,
        description: error_description ? String(error_description) : null,
        state: state ? 'present' : 'missing',
        savedState: savedState ? 'present' : 'missing'
      });
      return res.redirect(getAuthRedirectUrl(req, {
        auth: authStatus,
        platform: 'cime',
        reason: errorCode
      }));
    }

    if (!code || !state || !savedState || state !== savedState) {
      return res.status(400).send('Invalid state or code');
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

    return res.redirect(getAuthRedirectUrl(req, { auth: 'success', platform: 'cime', reason: null }));
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
    const tokens = await getPlatformTokens('cime', ownerUserId);
    const platformUserId = tokens?.platformUserId || null;
    if (tokens) {
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
      await deletePlatformTokens('cime', ownerUserId);
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

app.post('/api/cime/chat/send', async (req, res) => {
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

app.get('/api/viewer/points', async (req, res) => {
  try {
    const ownerUserId = await getCurrentSessionUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: 'Login required' });

    const platforms = await listPlatformAccounts(ownerUserId).catch(() => []);
    const identityKeys = collectViewerPointIdentityKeys(ownerUserId, platforms);
    const balances = await listViewerPointBalancesForUserIds(identityKeys);
    const normalizedBalances = balances.map((balance) => ({
      ...balance,
      publicLinks: {
        home: `/c/${encodeURIComponent(balance.channelUid)}`,
        commands: `/c/${encodeURIComponent(balance.channelUid)}/commands`,
        points: `/c/${encodeURIComponent(balance.channelUid)}/points`,
        roulette: `/c/${encodeURIComponent(balance.channelUid)}/roulette`,
      },
    }));

    return res.json({
      userId: ownerUserId,
      platforms,
      balances: normalizedBalances,
      totalPoints: normalizedBalances.reduce((sum, balance) => sum + Number(balance.points || 0), 0),
    });
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
    if (providerFilter && !['chzzk', 'cime'].includes(providerFilter)) {
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

// Public API: live status and basic info by channel UID (no auth)
app.get('/api/public/:uid/live', async (req, res) => {
  const uid = String(req.params.uid || '').trim();
  if (!uid) return res.status(400).json({ error: 'uid required' });
  try {
    const r = await axiosGetWithRetry(`https://api.chzzk.naver.com/service/v2/channels/${encodeURIComponent(uid)}/live-detail`);
    const content = r?.data?.content || r?.data || {};
    const status = String(content?.status || '').toLowerCase();
    const channelName = content?.channel?.channelName || content?.channel?.name || '';
    const title = content?.liveTitle || content?.title || '';
    const category = content?.liveCategory?.categoryType || content?.categoryType || content?.liveCategoryName || '';
    const viewers = Number(content?.concurrentUserCount || 0);
    return res.json({ live: status === 'open', channelName, title, category, viewers });
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
      try { await isLiveAllowedForSid(sid); } catch { }
    }
  } catch { }
}, 60 * 1000);

// Public live status endpoint (ignores onlyWhenLive; returns actual channel live state)
app.get('/api/chzzk/live', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    // Determine channel UID list
    const settings = await getBotSettings(sid) || {};
    let channelUids = Array.isArray(settings.channelUids) ? settings.channelUids.map(String).filter(Boolean) : [];
    if (!channelUids.length) {
      try {
        const accessToken = await getValidAccessToken(sid);
        const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const content = me?.data?.content || me?.data || {};
        if (content?.channelId) channelUids = [String(content.channelId)];
      } catch { }
    }
    if (!channelUids.length) return res.json({ live: false });
    let live = false;
    for (const uid of channelUids) {
      try {
        const r = await axiosGetWithRetry(`https://api.chzzk.naver.com/service/v2/channels/${encodeURIComponent(uid)}/live-detail`);
        const status = String((r?.data?.content || r?.data || {})?.status || '').toLowerCase();
        if (status === 'open') { live = true; break; }
      } catch (e) {
        console.warn('[live endpoint] live-detail failed for', uid, e?.code || e?.message || e);
      }
    }
    return res.json({ live });
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
app.get('/api/bot/rules', async (req, res) => {
  const sid = await getPartitionId(req, res);
  if (!sid) return res.json({ rules: [] });
  const rules = await getBotRules(sid);
  return res.json({ rules });
});

app.post('/api/bot/rules/upsert', async (req, res) => {
  const sid = await getPartitionId(req, res);
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
    return res.json({ ok: true });
  } catch (e) {
    console.error('Rule upsert failed:', e?.message || e, e?.hint || '', e?.details || '');
    return res.status(500).json({ error: 'Failed to save rule' });
  }
});

app.post('/api/bot/rules/delete', async (req, res) => {
  const sid = await getPartitionId(req, res);
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
    const settings = await getBotSettings(sid) || {};
    let channelUids = Array.isArray(settings.channelUids) ? settings.channelUids.map(String).filter(Boolean) : [];
    if (channelUids.length) return channelUids[0];
    // fallback via users/me
    const accessToken = await getValidAccessToken(sid);
    const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const content = me?.data?.content || me?.data || {};
    if (content?.channelId) return String(content.channelId);
  } catch { }
  return null;
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

async function handlePredictionBetCommand({ channelUid, userId, username, text }) {
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
    const rows = await listChannelPoints(uid);
    return res.json({ points: rows });
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
    const rows = await listChannelPoints(channelUid);
    const hit = rows.find((r) => String(r.user_id || r.userId || '') === userId);
    if (!hit) return res.status(404).json({ error: 'Not found' });
    return res.json({ userId, username: hit.username ?? null, points: Number(hit.points || 0) });
  } catch (e) {
    console.error('[channelpoints:get] error', e?.message || e);
    return res.status(500).json({ error: 'Failed to get channel points' });
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
    // listChannelPoints returns all; to avoid heavy memory, we can slice here as a first step
    // If needed, this can be optimized to query with OFFSET/LIMIT in supabase.js
    const all = await listChannelPoints(uid);
    const rows = all.slice(offset, offset + limit);
    return res.json({ rows, total: all.length, offset, limit });
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
    const prediction = await getActivePredictionForChannel(uid);
    return res.json({ uid, prediction });
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

// Public API: list rules for streamer by channel UID
app.get('/api/public/:uid/rules', async (req, res) => {
  const uid = String(req.params.uid || '').trim();
  if (!uid) return res.status(400).json({ error: 'uid required' });
  try {
    // Heuristic: try to find any sid whose settings contain this uid
    // Since supabase client isn't exposed, reuse getBotSettings for a set of candidate sids seen recently
    const candidates = Array.from(activeSids.keys());
    for (const sid of candidates) {
      try {
        const s = await getBotSettings(sid) || {};
        const uids = Array.isArray(s.channelUids) ? s.channelUids.map(String) : [];
        if (uids.includes(uid)) {
          const rules = await getBotRules(sid);
          const simplified = (rules || []).filter(r => r.enabled).map(r => ({
            id: r.id,
            name: r.name,
            keywords: r.keywords,
            responses: r.responses,
            adminOnly: !!r.adminOnly,
            cooldown: r.cooldown,
            requiredRoleLevel: r.requiredRoleLevel,
          }));
          return res.json({ uid, rules: simplified });
        }
      } catch { }
    }
    // If not found, return empty list
    return res.json({ uid, rules: [] });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load rules' });
  }
});

// Public API: list points for streamer by channel UID
app.get('/api/public/:uid/points', async (req, res) => {
  const uid = String(req.params.uid || '').trim();
  if (!uid) return res.status(400).json({ error: 'uid required' });
  try {
    const rows = await listChannelPoints(uid);
    return res.json({ uid, points: rows });
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

    // Ensure we have a live session with a sessionKey
    // Auto-detect channel (same as events endpoint) to establish the session
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

    const entry = await ensureSession(sid, channelId ? String(channelId) : undefined);
    if (!entry || !entry.sessionKey) {
      return res.status(409).json({ error: 'No active sessionKey' });
    }

    const accessToken = await getValidAccessToken(sid);
    const url = `${OPENAPI_BASE}/open/v1/chats/send`;
    const r = await axios.post(url, { message }, {
      params: { sessionKey: entry.sessionKey },
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
    console.log('[auth:callback] Parameters:', { 
      code: code ? 'present' : 'missing',
      state: state ? 'present' : 'missing',
      savedState: savedState ? 'present' : 'missing',
      error: error ? String(error) : null
    });

    if (error) {
      if (savedState && state && state === savedState) {
        clearManagedCookie(res, 'oauth_state');
      }
      const errorCode = String(error || '');
      const authStatus = errorCode === 'access_denied' ? 'cancelled' : 'error';
      console.warn('[CHZZK] OAuth authorization did not complete:', {
        error: errorCode,
        description: error_description ? String(error_description) : null,
        state: state ? 'present' : 'missing',
        savedState: savedState ? 'present' : 'missing'
      });
      return res.redirect(getAuthRedirectUrl(req, {
        auth: authStatus,
        platform: 'chzzk',
        reason: errorCode
      }));
    }

    if (!code || !state || !savedState || state !== savedState) {
      return res.status(400).send('Invalid state or code');
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
    try {
      const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const content = me?.data?.content || me?.data || {};
      if (content?.channelId) {
        const platformUserId = String(content.channelId);
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
          if (content2?.userId) {
            const platformUserId = String(content2.userId);
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

    // Redirect back to app with success flag
    return res.redirect(getAuthRedirectUrl(req, { auth: 'success', platform: 'chzzk', reason: null }));
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
    const sid = ownerUserId ? `user:${ownerUserId}` : await getPartitionId(req, res);
    const tokens = sid ? await getTokens(sid) : null;
    if (tokens) {
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
      const chzzkAccount = accounts.find((account) => String(account.provider || '').toLowerCase() === 'chzzk');
      try { await deletePlatformAccount('chzzk', ownerUserId, chzzkAccount?.platform_user_id || null); } catch { }
      const platforms = await listPlatformAccounts(ownerUserId).catch(() => []);
      return res.json({ ok: true, platforms });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('Revoke error', e?.response?.data || e.message);
    return res.status(500).json({ error: 'Failed to revoke' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// =============================
// =============================

app.get('/api/channel/context', async (req, res) => {
  try {
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

    const safeContext = {
      channelId: channelContext.channelId,
      channelName: channelContext.channelId,
      userId: channelContext.userId,
      isolated: channelContext.isolationLevel === 'strict',
      lastActivity: channelContext.lastActivity,
      connectionId: channelContext.connectionId
    };

    console.log('[ChannelContext] Context retrieved:', {
      channelId: safeContext.channelId,
      userId: safeContext.userId
    });

    return res.json(safeContext);

  } catch (error) {
    console.error('[ChannelContext] Failed to get context:', error);
    return res.status(500).json({
      error: 'Failed to retrieve channel context',
      code: 'CONTEXT_ERROR'
    });
  }
});

app.get('/api/channel/cache-stats', async (req, res) => {
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

app.get('/api/channel/performance', async (req, res) => {
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
    if (process.env.SUPABASE_URL && process.env.SUPABASE_DB_URL) {
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

app.get('/api/admin/database/performance', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    //
    const { analyzeDatabasePerformance } = await import('./sqlite.js');
    const sqliteAnalysis = analyzeDatabasePerformance();

    let supabaseAnalysis = null;
    if (process.env.SUPABASE_URL && process.env.SUPABASE_DB_URL) {
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

app.post('/api/admin/database/optimize', async (req, res) => {
  try {
    const sid = await getPartitionId(req, res);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { optimizeDatabase } = await import('./sqlite.js');
    const sqliteResult = optimizeDatabase();

    let supabaseResult = null;
    if (process.env.SUPABASE_URL && process.env.SUPABASE_DB_URL) {
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

app.get('/api/admin/security/channel-access', async (req, res) => {
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

app.post('/api/admin/security/channel-access/reset', async (req, res) => {
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

app.get('/api/admin/security/events', async (req, res) => {
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

app.get('/api/admin/security/statistics', async (req, res) => {
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

app.get('/api/admin/security/suspicious-tokens', async (req, res) => {
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

app.get('/api/channel/tokens/stats', async (req, res) => {
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
    if (process.env.SUPABASE_URL) {
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

app.get('/api/channel/tokens/usage', async (req, res) => {
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

app.post('/api/channel/tokens/cleanup', async (req, res) => {
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

app.post('/api/channel/tokens/validate', async (req, res) => {
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

app.get('/api/channel/tokens/management', async (req, res) => {
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

app.post('/api/channel/tokens/generate', async (req, res) => {
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

app.get('/api/channel/tokens/report', async (req, res) => {
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

app.get('/api/channel/tokens/health', async (req, res) => {
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

app.post('/api/channel/tokens/maintenance', async (req, res) => {
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

// Manual bootstrap: attach current cookie sid to a userId resolved from any stored tokens
app.post('/api/auth/chzzk/session/attach', async (req, res) => {
  try {
    const cookieSid = getCookieSid(req);
    if (!cookieSid) return res.status(400).json({ error: 'No cookie sid' });
    // If already mapped, succeed
    const mapped = await getSessionUserId(cookieSid);
    if (mapped) return res.json({ ok: true, userId: mapped, note: 'already_mapped' });

    const anyTok = await getAnyTokens();
    if (!anyTok) return res.status(404).json({ error: 'No tokens in DB' });
    let tokenType = anyTok.tokenType || 'Bearer';
    let accessToken = anyTok.accessToken;
    let refreshToken = anyTok.refreshToken;
    const originSid = anyTok.sid; // where tokens are stored currently

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
const sessionStore = new Map(); // sid -> entry
// Deduplicate: share one socket per channelId across multiple sids
const channelSessionStore = new Map(); // channelId -> entry
// Global per-channel dedup for processed chat ids and sent replies to avoid duplicates on reconnects
const globalProcessedChat = new Map(); // channelId -> Set(keys)
const globalSentReplies = new Map();   // channelId -> Set(keys)
const MAX_QUEUE = 1000;
const sessionCreatePromises = new Map(); // sid -> Promise(entry)

async function ensureSession(sid, channelId) {
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

          // Live-only gate per sid
          const allowed = await isLiveAllowedForSid(sid);
          if (!allowed) return;

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
              isBotSelf = true; // we'll skip attendance below but still allow rules if needed
            }
          } catch { }

          // Attendance: only when actually live. If not live, always skip attendance.
          const currentlyLive = !!(liveStatusCache.get(sid)?.live);
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
                    if (shouldAnnounce) {
                      const accessToken = await getValidAccessToken(sid);
                      if (entry.sessionKey && accessToken) {
                        const url = `${OPENAPI_BASE}/open/v1/chats/send`;
                        let totalDays = 0;
                        try { totalDays = await getUserAttendanceTotalDays(sid, resolvedUserId); } catch { }
                        const text = `${resolvedUsername}님 출석체크 완료! (연속 ${result.streak}일, 누적 ${totalDays}일)`;
                        await axios.post(url, { message: text }, {
                          params: { sessionKey: entry.sessionKey },
                          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
                        }).catch(() => { });
                      }
                    }
                    // Attendance bonus channel points
                    try {
                      const bonus = Math.max(0, Number(settings.channelPointsPerAttendance || 0));
                      if (bonus > 0) {
                        // Resolve streamer channel UID
                        let channelUid = null;
                        try {
                          const accessToken = await getValidAccessToken(sid);
                          const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
                          const content = me?.data?.content || me?.data || {};
                          channelUid = content?.channelId ? String(content.channelId) : null;
                        } catch { }
                        if (!channelUid) {
                          const uids = Array.isArray(settings.channelUids) ? settings.channelUids.map(String).filter(Boolean) : [];
                          if (uids.length) channelUid = uids[0];
                        }
                        // Channel points exclusion list
                        const cpExcludedFromText = typeof settings.channelPointsExcludeUserIdsText === 'string'
                          ? settings.channelPointsExcludeUserIdsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
                          : [];
                        const cpExcludedSet = new Set(cpExcludedFromText.map(String));
                        if (channelUid && !cpExcludedSet.has(String(resolvedUserId))) {
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
              try {
                const accessToken = await getValidAccessToken(sid);
                const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
                const content = me?.data?.content || me?.data || {};
                channelUid = content?.channelId ? String(content.channelId) : null;
              } catch { }
              if (!channelUid) {
                const settings = await getBotSettings(sid) || {};
                const uids = Array.isArray(settings.channelUids) ? settings.channelUids.map(String).filter(Boolean) : [];
                if (uids.length) channelUid = uids[0];
              }
              if (channelUid) {
                // Respect channel points exclusion list from settings
                let cpExcluded = new Set();
                try {
                  const settings = await getBotSettings(sid) || {};
                  const cpExcludedFromText = typeof settings.channelPointsExcludeUserIdsText === 'string'
                    ? settings.channelPointsExcludeUserIdsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
                    : [];
                  cpExcluded = new Set(cpExcludedFromText.map(String));
                } catch { }
                // Determine per-chat amount from settings (default 1)
                let perChat = 1;
                try {
                  const settings = await getBotSettings(sid) || {};
                  perChat = Math.max(0, Number(settings.channelPointsPerChat ?? 1));
                } catch { }
                // Skip awarding to owner or bot self
                let ownerUserId = null;
                try { const owner = await getOwnerInfoForSid(sid); ownerUserId = owner?.userId ? String(owner.userId) : null; } catch { }
                if (perChat > 0 && resolvedUserId && String(resolvedUserId) !== String(ownerUserId) && !isBotSelf && !cpExcluded.has(String(resolvedUserId))) {
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
                channelUid,
                userId: resolvedUserId,
                username: resolvedUsername,
                text,
              });
              if (predictionReply) {
                const accessToken = await getValidAccessToken(sid);
                if (entry.sessionKey && accessToken) {
                  await axios.post(`${OPENAPI_BASE}/open/v1/chats/send`, { message: predictionReply }, {
                    params: { sessionKey: entry.sessionKey },
                    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
                  }).catch(() => { });
                }
                return;
              }
            } catch (e) {
              console.error('[Prediction] CHZZK command error', e?.message || e);
            }
          }

          // Load per-user rules (empty if disabled)
          const rules = botDisabled ? [] : await getBotRules(sid);
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

            const executionContext = msg?.executionContext || { source: 'chat', shouldDeductPoints: true };
            const shouldSkipPointsDeduction = executionContext.source === 'roulette' || !executionContext.shouldDeductPoints;

            if (!isRouletteRule && commandCost > 0 && resolvedUserId && !shouldSkipPointsDeduction) {
              try {
                // Resolve streamer channel UID (same as other points operations)
                let channelUid = null;
                try {
                  const accessToken = await getValidAccessToken(sid);
                  const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
                  const content = me?.data?.content || me?.data || {};
                  channelUid = content?.channelId ? String(content.channelId) : null;
                } catch { }
                if (!channelUid) {
                  const s = await getBotSettings(sid) || {};
                  const uids = Array.isArray(s.channelUids) ? s.channelUids.map(String).filter(Boolean) : [];
                  if (uids.length) channelUid = uids[0];
                }
                if (channelUid) {
                  const have = await getChannelPoints(channelUid, String(resolvedUserId)).catch(() => 0);
                  if (Number(have || 0) < commandCost) {
                    // Not enough points: override response and block execution
                    response = `포인트가 부족합니다. (${commandCost} 필요, ${Number(have || 0)} 보유 중)`;
                    allowExecute = false;
                  } else {
                    // Deduct cost now
                    await incrChannelPoints(channelUid, String(resolvedUserId), String(resolvedUsername || ''), -commandCost);
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
              const startArgRaw = Array.isArray(argsVd) ? argsVd[1] : undefined;
              const playArgRaw = Array.isArray(argsVd) ? argsVd[2] : undefined;
              
              // URL, YouTube URL, or 11-character video ID.
              const looksLikeUrl = /^https?:\/\//i.test(firstArg) || /youtu/i.test(firstArg) || /^[A-Za-z0-9_-]{11}$/.test(firstArg);
              
              const urlArg = looksLikeUrl ? firstArg : (Array.isArray(argsVd) ? argsVd.join(' ') : firstArg);
              
              if (urlArg) {
                try {
                  const settings = await getBotSettings(sid) || {};
                  const enabled = settings.videoDonationAcceptEnabled === true;
                  if (!enabled) {
                    responseToSend = (String(response).replace(vdReAll, '').trim() || '지금은 영상 요청을 받을 수 없습니다.');
                  } else {
                    const pps = Math.max(0, Number(settings.videoDonationPointsPerSecond ?? 1));
                    const maxDur = Math.max(1, Number(settings.videoDonationMaxDurationSec ?? 600));
                    
                    const inputArg = String(urlArg || '').trim();
                    const looksDirectArg = /youtu/i.test(inputArg) || /^[A-Za-z0-9_-]{11}$/.test(inputArg);
                    let videoId = looksDirectArg ? extractYouTubeId(inputArg) : null;
                    if (!videoId && inputArg) {
                      try { videoId = await searchYouTubeVideoIdByQuery(inputArg); } catch { }
                    }
                    if (!videoId) {
                      responseToSend = (String(response).replace(vdReAll, '').trim() || '잘못된 링크입니다.');
                    } else {
                      const startNum = Number(startArgRaw);
                      const playNum = Number(playArgRaw);
                      const start = Math.max(0, Number.isFinite(startNum) ? startNum : 0);
                      const play = Number.isFinite(playNum) && playNum > 0 ? Math.floor(playNum) : null;
                      // Fetch YouTube info (title/duration) via Data API if available
                      let ytTitle = null; let ytDuration = null;
                      try {
                        const info = await fetchYouTubeInfo(videoId);
                        ytTitle = info.title || null;
                        ytDuration = Number.isFinite(info.durationSec) ? Number(info.durationSec) : null;
                      } catch (e) {
                        console.warn('[pvd:autoReply] YouTube API failed:', e?.message || e);
                      }
                      // Fallback: oEmbed title
                      if (!ytTitle) {
                        try {
                          const enc = encodeURIComponent(`https://youtu.be/${videoId}`);
                          const r = await axios.get(`https://www.youtube.com/oembed?url=${enc}&format=json`, { timeout: 3000 });
                          ytTitle = r?.data?.title || null;
                        } catch (e) {
                          console.warn('[pvd:autoReply] oEmbed title fetch failed');
                        }
                      }
                      // If explicit play length provided, use it; otherwise use remaining duration from start
                      const remaining = ytDuration != null ? Math.max(1, (ytDuration - start)) : maxDur;
                      const baseDur = play != null ? play : remaining;
                      const dur = Math.max(1, Math.min(maxDur, baseDur));
                      const cost = Math.ceil(pps * dur);
                      
                      if (ytDuration == null && play == null) {
                        console.warn('[pvd:autoReply] duration unknown; using maxDur', { videoId, maxDur });
                      }
                      // Deduct points after checking balance
                      let channelUid = null;
                      try {
                        const accessToken = await getValidAccessToken(sid);
                        const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
                        const content = me?.data?.content || me?.data || {};
                        channelUid = content?.channelId ? String(content.channelId) : null;
                      } catch { }
                      if (!channelUid) {
                        const s = await getBotSettings(sid) || {};
                        const uids = Array.isArray(s.channelUids) ? s.channelUids.map(String).filter(Boolean) : [];
                        if (uids.length) channelUid = uids[0];
                      }
                      if (!channelUid) {
                        responseToSend = (String(response).replace(vdReAll, '').trim() || '채널 ID를 확인할 수 없습니다.');
                      } else {
                        const have = await getChannelPoints(channelUid, String(resolvedUserId)).catch(() => 0);
                        if (Number(have || 0) < cost) {
                          responseToSend = `포인트가 부족합니다. 필요: ${cost}, 보유: ${Number(have || 0)}`;
                        } else {
                          await incrChannelPoints(channelUid, String(resolvedUserId), String(resolvedUsername || ''), -cost);
                          // Enqueue
                          const q = getVideoQueue(sid);
                          const item = {
                            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                            ts: Date.now(),
                            videoId,
                            title: ytTitle,
                            durationSec: dur,
                            startSec: start,
                            cost,
                            userId: String(resolvedUserId),
                            username: String(resolvedUsername || ''),
                            status: 'queued'
                          };
                          q.push(item);
                          if (q.length === 1) {
                            broadcastPvdStart(sid);
                            scheduleNextPvdAutoPop(sid);
                          }
                          // Build reply including resolved title if available
                          try {
                            const cleaned = String(response).replace(vdReAll, '').trim();
                            const t = ytTitle ? (ytTitle.length > 20 ? `${ytTitle.slice(0, 20)}...` : ytTitle) : null;
                            const baseMsg = t ? `요청을 접수했습니다. ${t}` : '요청을 접수했습니다.';
                            responseToSend = cleaned ? `${cleaned} ${baseMsg}`.trim() : baseMsg;
                          } catch {
                            responseToSend = '요청을 접수했습니다.';
                          }
                        }
                      }
                    }
                  }
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
                      try {
                        const accessToken = await getValidAccessToken(sid);
                        const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
                        const content = me?.data?.content || me?.data || {};
                        channelUid = content?.channelId ? String(content.channelId) : null;
                      } catch (e) { /* fall through to settings */ }
                      if (!channelUid) {
                        const s = await getBotSettings(sid) || {};
                        const uids = Array.isArray(s.channelUids) ? s.channelUids.map(String).filter(Boolean) : [];
                        if (uids.length) channelUid = uids[0];
                      }
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
                      const queuePosition = enqueueRouletteSpin(sid, { ...base, instant: false });
                      console.log(`[Roulette] First spin enqueued at position: ${queuePosition}`);

                      // Remaining spins (if any): instant display on viewer
                      for (let i = 1; i < count; i++) {
                        const pos = enqueueRouletteSpin(sid, { ...base, instant: true });
                        console.log(`[Roulette] Spin ${i + 1} enqueued at position: ${pos}`);
                      }

                      responseToSend = '';

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
              const replyKey = (() => {
                try {
                  const u = String(msg?.profile?.userId || msg?.senderChannelId || '');
                  const t0 = String(msg?.messageTime || msg?.timestamp || msg?.msgTime || '');
                  const m0 = String(msg?.messageId || msg?.id || msg?.msgId || msg?.eventId || '');
                  return m0 || `${u}|${t0}`;
                } catch { return `${Date.now()}`; }
              })();
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
              try {
                const accessToken = await getValidAccessToken(sid);
                const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
                const content = me?.data?.content || me?.data || {};
                channelUid = content?.channelId ? String(content.channelId) : null;
              } catch { }
              if (!channelUid) {
                const uids = Array.isArray(settings.channelUids) ? settings.channelUids.map(String).filter(Boolean) : [];
                if (uids.length) channelUid = uids[0];
              }
              if (channelUid) {
                // Use donor's userId (channel id) as the points subject
                const pointsUserId = donorId || `donor:${donorName}`;
                try { await incrChannelPoints(channelUid, String(pointsUserId), donorName, award); } catch { }
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
              const min = r.minAmount != null ? Number(r.minAmount) : null;
              const max = r.maxAmount != null ? Number(r.maxAmount) : null;
              if (min != null && amount < min) continue;
              if (max != null && amount > max) continue;
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
                    enqueueRouletteSpin(sid, { ...base, instant: false });
                  }
                } catch { }
              }
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
    // Do not subscribe here; wait for SYSTEM 'connected' event to set sessionKey first
    return created;
  } finally {
    sessionCreatePromises.delete(sid);
  }
}

async function ensureSubscribed(entry, sid, channelId) {
  // Subscriptions are per user session in CHZZK docs; channelId is not required for subscribe endpoints.
  if (entry.subscribed.has('ALL')) return;
  // Ensure sessionKey is available (SYSTEM connected processed)
  if (!entry.sessionKey) {
    // wait briefly up to 3s
    const start = Date.now();
    while (!entry.sessionKey && Date.now() - start < 3000) {
      await new Promise(r => setTimeout(r, 50));
    }
  }
  if (!entry.sessionKey) throw new Error('No sessionKey yet');
  const accessToken = await getValidAccessToken(sid);
  await subscribeEvent('chat', entry.sessionKey, undefined, accessToken);
  await subscribeEvent('donation', entry.sessionKey, undefined, accessToken);
  await subscribeEvent('subscription', entry.sessionKey, undefined, accessToken);
  entry.subscribed.add('ALL');
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

const cimeSessionStore = new Map(); // ownerUserId -> entry
const cimeSessionCreatePromises = new Map(); // ownerUserId -> Promise(entry)

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
    const ts = data.messageTime ? Date.parse(data.messageTime) : Date.now();
    const messageId = data.messageId || data.id || `${data.senderChannelId || data.profile?.nickname || 'chat'}:${data.messageTime || ts}:${String(data.content || '').slice(0, 80)}`;
    return {
      eventName,
      data,
      ev: {
        type: 'chat',
        id: String(messageId),
        ts: Number.isFinite(ts) ? ts : Date.now(),
        user: data.profile?.nickname || data.senderNickname || 'Unknown',
        userId: data.senderChannelId || data.profile?.userId || '',
        message: data.content || '',
        raw: data,
        provider: 'cime'
      }
    };
  }

  if (eventName === 'DONATION') {
    const ts = Date.now();
    return {
      eventName,
      data,
      ev: {
        type: 'donation',
        id: `${data.donatorChannelId || data.donatorNickname || 'donation'}:${ts}`,
        ts,
        user: data.donatorNickname || 'Unknown',
        userId: data.donatorChannelId || '',
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
    return {
      eventName,
      data,
      ev: {
        type: 'subscription',
        id: `${data.subscriberChannelId || data.subscriberChannelName || 'subscription'}:${ts}`,
        ts,
        user: data.subscriberChannelName || 'Unknown',
        userId: data.subscriberChannelId || '',
        months: Number(data.month || 0),
        message: data.subscriptionText || data.tierName || '',
        raw: data,
        provider: 'cime'
      }
    };
  }

  return null;
}

async function getCimeChannelId(ownerUserId) {
  const tokens = await getPlatformTokens('cime', ownerUserId);
  if (tokens?.platformUserId) return String(tokens.platformUserId);
  return null;
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
  return unwrapOpenApiContent(r);
}

async function isCimeLiveAllowed(ownerUserId, sid, channelId) {
  try {
    const settings = await getBotSettings(sid) || {};
    const onlyWhenLive = !!settings.onlyWhenLive;
    if (!onlyWhenLive) return true;
    const cached = liveStatusCache.get(sid);
    const now = Date.now();
    if (cached && cached.provider === 'cime' && (now - cached.ts) < 60 * 1000) return !!cached.live;
    const cid = channelId || await getCimeChannelId(ownerUserId);
    if (!cid) return false;
    const r = await axios.get(`${CIME_OPENAPI_BASE}/v1/${encodeURIComponent(cid)}/live-status`);
    const content = unwrapOpenApiContent(r);
    const status = String(content?.status || content?.liveStatus || content?.state || '').toLowerCase();
    const live = content?.live === true || content?.isLive === true || ['open', 'live', 'onair', 'on_air'].includes(status);
    liveStatusCache.set(sid, { ts: now, live, provider: 'cime' });
    if (live && !liveSession.get(sid)?.live) {
      const today = getKstDateString();
      liveSession.set(sid, { live: true, startDate: today, sessionStartTime: Date.now(), lastUpdate: now });
      try {
        await upsertLiveSessionToDB({
          sid,
          live: true,
          start_date: today,
          session_start_time: Date.now(),
          last_update: now
        });
      } catch { }
    }
    return live;
  } catch {
    return false;
  }
}

async function enqueueVideoDonationFromArgs({ sid, channelUid, userId, username, args, response, vdReAll }) {
  const firstArg = Array.isArray(args) ? (args[0] || '') : '';
  const startArgRaw = Array.isArray(args) ? args[1] : undefined;
  const playArgRaw = Array.isArray(args) ? args[2] : undefined;
  const looksLikeUrl = /^https?:\/\//i.test(firstArg) || /youtu/i.test(firstArg) || /^[A-Za-z0-9_-]{11}$/.test(firstArg);
  const urlArg = looksLikeUrl ? firstArg : (Array.isArray(args) ? args.join(' ') : firstArg);
  const cleaned = String(response || '').replace(vdReAll, '').trim();
  if (!urlArg) return cleaned || '링크를 입력해 주세요.';

  const settings = await getBotSettings(sid) || {};
  if (settings.videoDonationAcceptEnabled !== true) return cleaned || '지금은 영상 요청을 받을 수 없습니다.';

  const pps = Math.max(0, Number(settings.videoDonationPointsPerSecond ?? 1));
  const maxDur = Math.max(1, Number(settings.videoDonationMaxDurationSec ?? 600));
  const inputArg = String(urlArg || '').trim();
  const looksDirectArg = /youtu/i.test(inputArg) || /^[A-Za-z0-9_-]{11}$/.test(inputArg);
  let videoId = looksDirectArg ? extractYouTubeId(inputArg) : null;
  if (!videoId && inputArg) {
    try { videoId = await searchYouTubeVideoIdByQuery(inputArg); } catch { }
  }
  if (!videoId) return cleaned || '올바른 링크나 검색어를 입력해 주세요.';

  const startNum = Number(startArgRaw);
  const playNum = Number(playArgRaw);
  const start = Math.max(0, Number.isFinite(startNum) ? startNum : 0);
  const play = Number.isFinite(playNum) && playNum > 0 ? Math.floor(playNum) : null;
  let ytTitle = null;
  let ytDuration = null;
  try {
    const info = await fetchYouTubeInfo(videoId);
    ytTitle = info.title || null;
    ytDuration = Number.isFinite(info.durationSec) ? Number(info.durationSec) : null;
  } catch { }
  if (!ytTitle) {
    try {
      const enc = encodeURIComponent(`https://youtu.be/${videoId}`);
      const r = await axios.get(`https://www.youtube.com/oembed?url=${enc}&format=json`, { timeout: 3000 });
      ytTitle = r?.data?.title || null;
    } catch { }
  }

  const remaining = ytDuration != null ? Math.max(1, ytDuration - start) : maxDur;
  const dur = Math.max(1, Math.min(maxDur, play != null ? play : remaining));
  const cost = Math.ceil(pps * dur);
  if (!channelUid) return cleaned || '채널 ID를 확인할 수 없습니다.';
  const have = await getChannelPoints(channelUid, String(userId)).catch(() => 0);
  if (Number(have || 0) < cost) return `포인트가 부족합니다. 필요: ${cost}, 보유: ${Number(have || 0)}`;

  await incrChannelPoints(channelUid, String(userId), String(username || ''), -cost);
  const q = getVideoQueue(sid);
  q.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    videoId,
    title: ytTitle,
    durationSec: dur,
    startSec: start,
    cost,
    userId: String(userId),
    username: String(username || ''),
    status: 'queued'
  });
  if (q.length === 1) {
    broadcastPvdStart(sid);
    scheduleNextPvdAutoPop(sid);
  }
  const title = ytTitle ? (ytTitle.length > 20 ? ytTitle.slice(0, 20) + '...' : ytTitle) : null;
  const baseMsg = title ? `요청을 접수했습니다. ${title}` : '요청을 접수했습니다.';
  return cleaned ? `${cleaned} ${baseMsg}`.trim() : baseMsg;
}

async function processCimeChatAutomation(entry, ev) {
  try {
    const ownerUserId = entry.ownerUserId;
    const sid = entry.primarySid || `user:${ownerUserId}`;
    const text = String(ev.message || '').trim();
    if (!text) return;

    const allowed = await isCimeLiveAllowed(ownerUserId, sid, entry.channelId);
    if (!allowed) return;

    const settings = await getBotSettings(sid) || {};
    const currentlyLive = !!(liveStatusCache.get(sid)?.live);
    const resolvedUserId = String(ev.userId || ev.user || 'unknown_user');
    const resolvedUsername = String(ev.user || 'Unknown');
    const isOwner = entry.channelId && String(resolvedUserId) === String(entry.channelId);

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
            await sendCimeChat(ownerUserId, `${resolvedUsername}님 출석체크 완료! (연속 ${result.streak}일, 누적 ${totalDays}일)`).catch(() => { });
          }
          const bonus = Math.max(0, Number(settings.channelPointsPerAttendance || 0));
          if (bonus > 0 && entry.channelId) {
            await incrChannelPoints(entry.channelId, resolvedUserId, resolvedUsername, bonus).catch(() => { });
          }
        }
      } catch { }

      try {
        const cpExcludedFromText = typeof settings.channelPointsExcludeUserIdsText === 'string'
          ? settings.channelPointsExcludeUserIdsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
          : [];
        const cpExcludedSet = new Set(cpExcludedFromText.map(String));
        const perChat = Math.max(0, Number(settings.channelPointsPerChat ?? 1));
        if (entry.channelId && perChat > 0 && !isOwner && !cpExcludedSet.has(resolvedUserId)) {
          await incrChannelPoints(entry.channelId, resolvedUserId, resolvedUsername, perChat).catch(() => { });
        }
      } catch { }
    }

    if (settings.botEnabled === false) return;
    try {
      const predictionReply = await handlePredictionBetCommand({
        channelUid: entry.channelId,
        userId: resolvedUserId,
        username: resolvedUsername,
        text,
      });
      if (predictionReply) {
        await sendCimeChat(ownerUserId, predictionReply).catch(() => { });
        return;
      }
    } catch (e) {
      console.error('[Prediction] CIME command error', e?.message || e);
    }

    const rules = await getBotRules(sid);
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
      if (!isRouletteRule && commandCost > 0 && entry.channelId && resolvedUserId) {
        const have = await getChannelPoints(entry.channelId, resolvedUserId).catch(() => 0);
        if (Number(have || 0) < commandCost) {
          response = `포인트가 부족합니다. (${commandCost} 필요, ${Number(have || 0)} 보유 중)`;
          allowExecute = false;
        } else {
          await incrChannelPoints(entry.channelId, resolvedUserId, resolvedUsername, -commandCost).catch(() => { });
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
            channelUid: entry.channelId,
            userId: resolvedUserId,
            username: resolvedUsername,
            args,
            response: cleaned,
            vdReAll
          });
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
            if (commandCost > 0 && entry.channelId && resolvedUserId) {
              const need = commandCost * count;
              const have = await getChannelPoints(entry.channelId, resolvedUserId).catch(() => 0);
              if (Number(have || 0) < need) {
                cleaned = `포인트가 부족합니다. (${need} 필요, ${Number(have || 0)} 보유 중)`;
                allowExecute = false;
              } else {
                await incrChannelPoints(entry.channelId, resolvedUserId, resolvedUsername, -need).catch(() => { });
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
            enqueueRouletteSpin(sid, { ...base, instant: false });
            for (let i = 1; i < count; i++) enqueueRouletteSpin(sid, { ...base, instant: true });
            cleaned = '';
          }
        } catch (e) {
          cleaned = '룰렛 실행 중 오류가 발생했습니다.';
        }
      }
      cleaned = String(cleaned || '').trim();
      const replyKey = `${ev.id || ''}:${r.id || matchedKeyword || ''}`;
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
    if (award > 0 && entry.channelId) {
      await incrChannelPoints(entry.channelId, donorId, donorName, award).catch(() => { });
    }

    const responsesToSend = [];
    const rules = Array.isArray(settings.donationRules) ? settings.donationRules : [];
    const lowerMsg = donorMessage.toLowerCase();
    for (const r of rules) {
      if (!r || r.enabled === false) continue;
      const min = r.minAmount != null ? Number(r.minAmount) : null;
      const max = r.maxAmount != null ? Number(r.maxAmount) : null;
      if (min != null && amount < min) continue;
      if (max != null && amount > max) continue;
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
              instant: false
            });
          }
        } catch { }
      }
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

    const ws = new WebSocket(url, { handshakeTimeout: 5000 });
    entry.ws = ws;

    ws.on('open', async () => {
      entry.connected = true;
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
      if (eventName === 'CHAT') {
        processCimeChatAutomation(entry, ev).catch(() => { });
      } else if (eventName === 'DONATION') {
        processCimeDonationAutomation(entry, ev).catch(() => { });
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

    const entry = await ensureSession(sid, String(channelId));
    const sinceNum = since ? Number(since) : null;
    const events = entry.queue.filter(ev => !sinceNum || (ev.ts && ev.ts > sinceNum));
    // Sort ascending by ts
    events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return res.json({ events });
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

const server = app.listen(PORT, () => {
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
        const accessToken = await getValidAccessToken(sid);
        const me = await axios.get(`${OPENAPI_BASE}/open/v1/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const content = me?.data?.content || me?.data || {};
        const channelId = content.channelId || content.channel_id || null;
        if (channelId) {
          await ensureSession(sid, String(channelId));
        }
      } catch { }
      await new Promise(r => setTimeout(r, 100));
    }
  } catch { }
}

setTimeout(() => { bootstrapEnsureSessions().catch(() => { }); }, 0);

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
          if (!rouletteSession) {
            rouletteTokenToSid.delete(token);
            const error = new Error('Roulette session not found');
            error.code = 'SESSION_NOT_FOUND';
            throw error;
          }

          if (rouletteSession.sid !== sid) {
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
let wssRoulette; // Roulette viewer WS (noServer mode)

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
      if (u.pathname === '/api/roulette/ws') {
        wssRoulette.handleUpgrade(req, socket, head, (ws) => wssRoulette.emit('connection', ws, req));
        return;
      }
      if (u.pathname === '/api/desktop/ws') {
        wssDesktop.handleUpgrade(req, socket, head, (ws) => wssDesktop.emit('connection', ws, req));
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
          const allowed = new Set(['classic', 'fire', 'ice', 'cyber', 'gold', 'pastel', 'forest', 'sakura', 'midnight', 'sunset']);
          return allowed.has(t) ? t : undefined;
        })(),
      }))
      .filter(d => d.items.length > 0);
  } catch {
    return [];
  }
}
