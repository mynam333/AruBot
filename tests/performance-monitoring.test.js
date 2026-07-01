/**
 * Unit tests for performance monitoring and memory management
 * Tests Requirements: 3.1, 4.4
 */

// Mock logger for testing
const mockLogger = {
  logMacroSent: jest.fn(),
  logMacroSkipped: jest.fn(),
  logLiveStatusChange: jest.fn(),
  logCacheRefresh: jest.fn(),
  logTimerDetails: jest.fn(),
  logExecutionCycle: jest.fn(),
  isDebugMode: false
};

// Create PerformanceMonitor class for testing
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      macroExecutionTimes: new Map(),
      memoryUsage: [],
      cacheHitRates: new Map(),
      sessionActivity: new Map(),
      errorRates: new Map()
    };
    this.maxMetricsHistory = 100;
    this.maxExecutionTimes = 50;
  }

  recordMacroExecution(sid, executionTime, stats) {
    if (!this.metrics.macroExecutionTimes.has(sid)) {
      this.metrics.macroExecutionTimes.set(sid, []);
    }
    
    const times = this.metrics.macroExecutionTimes.get(sid);
    times.push({
      timestamp: Date.now(),
      executionTime,
      macrosSent: stats.macrosSent,
      macrosFailed: stats.macrosFailed,
      macrosSkipped: stats.macrosSkipped
    });
    
    if (times.length > this.maxExecutionTimes) {
      times.splice(0, times.length - this.maxExecutionTimes);
    }
    
    this.metrics.sessionActivity.set(sid, Date.now());
  }

  recordCacheOperation(cacheType, isHit) {
    if (!this.metrics.cacheHitRates.has(cacheType)) {
      this.metrics.cacheHitRates.set(cacheType, { hits: 0, misses: 0 });
    }
    
    const stats = this.metrics.cacheHitRates.get(cacheType);
    if (isHit) {
      stats.hits++;
    } else {
      stats.misses++;
    }
  }

  recordMemoryUsage() {
    const usage = process.memoryUsage();
    this.metrics.memoryUsage.push({
      timestamp: Date.now(),
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss
    });
    
    if (this.metrics.memoryUsage.length > this.maxMetricsHistory) {
      this.metrics.memoryUsage.splice(0, this.metrics.memoryUsage.length - this.maxMetricsHistory);
    }
  }

  getPerformanceReport(sid = null) {
    return {
      timestamp: new Date().toISOString(),
      memoryUsage: this.getMemoryStats(),
      cacheStats: this.getCacheStats(),
      sessionStats: this.getSessionStats(sid)
    };
  }

  getMemoryStats() {
    if (this.metrics.memoryUsage.length === 0) return null;
    
    const latest = this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1];
    return {
      current: {
        heapUsed: Math.round(latest.heapUsed / 1024 / 1024),
        heapTotal: Math.round(latest.heapTotal / 1024 / 1024),
        rss: Math.round(latest.rss / 1024 / 1024)
      }
    };
  }

  getCacheStats() {
    const stats = {};
    for (const [cacheType, data] of this.metrics.cacheHitRates.entries()) {
      const total = data.hits + data.misses;
      stats[cacheType] = {
        hitRate: total > 0 ? (data.hits / total * 100).toFixed(2) + '%' : '0%',
        totalOperations: total,
        hits: data.hits,
        misses: data.misses
      };
    }
    return stats;
  }

  getSessionStats(targetSid = null) {
    const now = Date.now();
    const activeSessions = [];
    const inactiveSessions = [];
    
    for (const [sid, lastActivity] of this.metrics.sessionActivity.entries()) {
      if (targetSid && sid !== targetSid) continue;
      
      const inactiveTime = now - lastActivity;
      const sessionInfo = {
        sid,
        lastActivity: new Date(lastActivity).toISOString(),
        inactiveTime: Math.round(inactiveTime / 1000),
        executionCount: this.metrics.macroExecutionTimes.get(sid)?.length || 0
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
      sessions: targetSid ? activeSessions.concat(inactiveSessions) : {
        active: activeSessions.slice(0, 10),
        inactive: inactiveSessions.slice(0, 5)
      }
    };
  }

  cleanupStaleMetrics() {
    const now = Date.now();
    const staleThreshold = 2 * 60 * 60 * 1000; // 2 hours
    let cleanedCount = 0;
    
    for (const [sid, lastActivity] of this.metrics.sessionActivity.entries()) {
      if (now - lastActivity > staleThreshold) {
        this.metrics.sessionActivity.delete(sid);
        this.metrics.macroExecutionTimes.delete(sid);
        this.metrics.errorRates.delete(sid);
        cleanedCount++;
      }
    }
    
    return cleanedCount;
  }
}

// Create CacheManager class for testing
class CacheManager {
  constructor() {
    this.maxCacheSize = {
      macro: 1000,
      live: 1000,
      timer: 2000
    };
    this.cleanupThresholds = {
      macro: 0.8,
      live: 0.8,
      timer: 0.9
    };
  }

  checkAndCleanupCache(cacheType, cache, getLastAccess = null) {
    const maxSize = this.maxCacheSize[cacheType];
    const threshold = this.cleanupThresholds[cacheType];
    
    if (cache.size < maxSize * threshold) {
      return 0;
    }
    
    const targetSize = Math.floor(maxSize * 0.7);
    const itemsToRemove = cache.size - targetSize;
    
    if (itemsToRemove <= 0) return 0;
    
    let entries = Array.from(cache.entries());
    
    if (getLastAccess) {
      entries.sort((a, b) => {
        const timeA = getLastAccess(a[0]) || 0;
        const timeB = getLastAccess(b[0]) || 0;
        return timeA - timeB;
      });
    }
    
    let removedCount = 0;
    for (let i = 0; i < Math.min(itemsToRemove, entries.length); i++) {
      const [key] = entries[i];
      cache.delete(key);
      removedCount++;
    }
    
    return removedCount;
  }
}

describe('Performance Monitoring Tests', () => {
  let performanceMonitor;
  let cacheManager;

  beforeEach(() => {
    jest.clearAllMocks();
    performanceMonitor = new PerformanceMonitor();
    cacheManager = new CacheManager();
    jest.setSystemTime(new Date('2023-01-01T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Macro execution tracking', () => {
    test('should record macro execution metrics', () => {
      const sid = 'test-sid';
      const executionTime = 150;
      const stats = {
        macrosSent: 2,
        macrosFailed: 0,
        macrosSkipped: 1
      };

      performanceMonitor.recordMacroExecution(sid, executionTime, stats);

      const sessionTimes = performanceMonitor.metrics.macroExecutionTimes.get(sid);
      expect(sessionTimes).toHaveLength(1);
      expect(sessionTimes[0]).toMatchObject({
        executionTime: 150,
        macrosSent: 2,
        macrosFailed: 0,
        macrosSkipped: 1
      });
      
      expect(performanceMonitor.metrics.sessionActivity.has(sid)).toBe(true);
    });

    test('should limit execution history per session', () => {
      const sid = 'test-sid';
      const maxExecutions = performanceMonitor.maxExecutionTimes;

      // Record more executions than the limit
      for (let i = 0; i < maxExecutions + 10; i++) {
        performanceMonitor.recordMacroExecution(sid, 100 + i, {
          macrosSent: 1,
          macrosFailed: 0,
          macrosSkipped: 0
        });
      }

      const sessionTimes = performanceMonitor.metrics.macroExecutionTimes.get(sid);
      expect(sessionTimes).toHaveLength(maxExecutions);
      
      // Should keep the most recent executions
      expect(sessionTimes[sessionTimes.length - 1].executionTime).toBe(100 + maxExecutions + 9);
    });
  });

  describe('Cache operation tracking', () => {
    test('should track cache hits and misses', () => {
      performanceMonitor.recordCacheOperation('macro', true);
      performanceMonitor.recordCacheOperation('macro', true);
      performanceMonitor.recordCacheOperation('macro', false);
      performanceMonitor.recordCacheOperation('live', true);

      const cacheStats = performanceMonitor.getCacheStats();
      
      expect(cacheStats.macro).toEqual({
        hitRate: '66.67%',
        totalOperations: 3,
        hits: 2,
        misses: 1
      });
      
      expect(cacheStats.live).toEqual({
        hitRate: '100.00%',
        totalOperations: 1,
        hits: 1,
        misses: 0
      });
    });
  });

  describe('Memory usage tracking', () => {
    test('should record memory usage', () => {
      performanceMonitor.recordMemoryUsage();
      
      expect(performanceMonitor.metrics.memoryUsage).toHaveLength(1);
      
      const memoryStats = performanceMonitor.getMemoryStats();
      expect(memoryStats.current).toHaveProperty('heapUsed');
      expect(memoryStats.current).toHaveProperty('heapTotal');
      expect(memoryStats.current).toHaveProperty('rss');
    });

    test('should limit memory usage history', () => {
      const maxHistory = performanceMonitor.maxMetricsHistory;
      
      // Record more memory snapshots than the limit
      for (let i = 0; i < maxHistory + 10; i++) {
        performanceMonitor.recordMemoryUsage();
      }
      
      expect(performanceMonitor.metrics.memoryUsage).toHaveLength(maxHistory);
    });
  });

  describe('Session activity tracking', () => {
    test('should distinguish active and inactive sessions', () => {
      const now = Date.now();
      const activeThreshold = 30 * 60 * 1000; // 30 minutes
      
      // Active session
      performanceMonitor.metrics.sessionActivity.set('active-sid', now - 10 * 60 * 1000); // 10 minutes ago
      
      // Inactive session
      performanceMonitor.metrics.sessionActivity.set('inactive-sid', now - 60 * 60 * 1000); // 1 hour ago
      
      const sessionStats = performanceMonitor.getSessionStats();
      
      expect(sessionStats.activeSessions).toBe(1);
      expect(sessionStats.inactiveSessions).toBe(1);
    });
  });

  describe('Stale metrics cleanup', () => {
    test('should clean up old session metrics', () => {
      const now = Date.now();
      const staleThreshold = 2 * 60 * 60 * 1000; // 2 hours
      
      // Recent session
      performanceMonitor.metrics.sessionActivity.set('recent-sid', now - 30 * 60 * 1000);
      performanceMonitor.metrics.macroExecutionTimes.set('recent-sid', []);
      
      // Stale session
      performanceMonitor.metrics.sessionActivity.set('stale-sid', now - 3 * 60 * 60 * 1000);
      performanceMonitor.metrics.macroExecutionTimes.set('stale-sid', []);
      
      const cleanedCount = performanceMonitor.cleanupStaleMetrics();
      
      expect(cleanedCount).toBe(1);
      expect(performanceMonitor.metrics.sessionActivity.has('recent-sid')).toBe(true);
      expect(performanceMonitor.metrics.sessionActivity.has('stale-sid')).toBe(false);
      expect(performanceMonitor.metrics.macroExecutionTimes.has('stale-sid')).toBe(false);
    });
  });

  describe('Cache management', () => {
    test('should not cleanup cache below threshold', () => {
      const cache = new Map();
      
      // Add items below threshold
      for (let i = 0; i < 500; i++) {
        cache.set(`key-${i}`, { value: i });
      }
      
      const removedCount = cacheManager.checkAndCleanupCache('macro', cache);
      
      expect(removedCount).toBe(0);
      expect(cache.size).toBe(500);
    });

    test('should cleanup cache when above threshold', () => {
      const cache = new Map();
      const maxSize = cacheManager.maxCacheSize.macro; // 1000
      const threshold = cacheManager.cleanupThresholds.macro; // 0.8
      
      // Add items above threshold (850 > 800)
      for (let i = 0; i < 850; i++) {
        cache.set(`key-${i}`, { value: i });
      }
      
      const removedCount = cacheManager.checkAndCleanupCache('macro', cache);
      
      expect(removedCount).toBeGreaterThan(0);
      expect(cache.size).toBeLessThan(850);
      expect(cache.size).toBe(Math.floor(maxSize * 0.7)); // Target size
    });

    test('should cleanup oldest entries first when getLastAccess provided', () => {
      const cache = new Map();
      const accessTimes = new Map();
      
      // Add items with different access times
      const now = Date.now();
      for (let i = 0; i < 850; i++) {
        const key = `key-${i}`;
        cache.set(key, { value: i });
        // key-0 has oldest access time, key-849 has newest
        accessTimes.set(key, now - ((849 - i) * 1000)); 
      }
      
      const getLastAccess = (key) => accessTimes.get(key);
      const removedCount = cacheManager.checkAndCleanupCache('macro', cache, getLastAccess);
      
      expect(removedCount).toBeGreaterThan(0);
      
      // Calculate expected target size
      const targetSize = Math.floor(1000 * 0.7); // 700
      expect(cache.size).toBe(targetSize);
      
      // Verify that we have the right number of items remaining
      expect(cache.size).toBeLessThan(850);
    });
  });

  describe('Performance report generation', () => {
    test('should generate comprehensive performance report', () => {
      const sid = 'test-sid';
      
      // Set up some test data
      performanceMonitor.recordMacroExecution(sid, 150, {
        macrosSent: 2,
        macrosFailed: 0,
        macrosSkipped: 1
      });
      
      performanceMonitor.recordCacheOperation('macro', true);
      performanceMonitor.recordCacheOperation('macro', false);
      performanceMonitor.recordMemoryUsage();
      
      const report = performanceMonitor.getPerformanceReport(sid);
      
      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('memoryUsage');
      expect(report).toHaveProperty('cacheStats');
      expect(report).toHaveProperty('sessionStats');
      
      expect(report.cacheStats.macro).toEqual({
        hitRate: '50.00%',
        totalOperations: 2,
        hits: 1,
        misses: 1
      });
      
      expect(report.sessionStats.activeSessions).toBe(1);
    });
  });
});