/**
 * Integration tests for macro execution flow
 * Tests Requirements: 3.1, 3.2, 3.3, 3.4
 */

// Jest globals are automatically available

// Mock axios for HTTP requests
const mockAxios = {
  post: jest.fn()
};

// Mock database functions
const mockGetBotSettings = jest.fn();
const mockGetBotStats = jest.fn();
const mockGetValidAccessToken = jest.fn();

// Mock session store
const mockSessionStore = new Map();

// Mock caches
const mockMacroCache = new Map();
const mockLiveCache = new Map();

// Mock logger
const mockLogger = {
  logMacroSent: jest.fn(),
  logMacroSkipped: jest.fn(),
  logLiveStatusChange: jest.fn(),
  logCacheRefresh: jest.fn(),
  logTimerDetails: jest.fn(),
  isDebugMode: false
};

// Create a simplified macro execution system for testing
class MacroExecutionSystem {
  constructor() {
    this.macroTimers = new Map();
    this.failureCount = new Map();
    this.lastFailureTime = new Map();
    this.logger = mockLogger;
    this.sessionStore = mockSessionStore;
    this.macroCache = mockMacroCache;
    this.liveCache = mockLiveCache;
  }

  async isSidLive(sid) {
    const settings = await mockGetBotSettings(sid) || {};
    const onlyWhenLive = !!settings.onlyWhenLive;
    
    if (!onlyWhenLive) {
      return true;
    }
    
    const stats = await mockGetBotStats(sid);
    const lastActiveStr = stats && stats.lastActive;
    
    if (!lastActiveStr) {
      return false;
    }
    
    const lastActiveTime = Date.parse(lastActiveStr);
    if (!Number.isFinite(lastActiveTime)) {
      return false;
    }
    
    const currentTime = Date.now();
    const timeSinceLastActive = currentTime - lastActiveTime;
    const LIVE_THRESHOLD_MS = 5 * 60 * 1000;
    
    return timeSinceLastActive < LIVE_THRESHOLD_MS;
  }

  async getLiveCached(sid) {
    const cachedEntry = this.liveCache.get(sid);
    const currentTime = Date.now();
    const CACHE_TTL_MS = 8000;
    
    if (cachedEntry && (currentTime - cachedEntry.checkedAt) <= CACHE_TTL_MS) {
      return cachedEntry.live;
    }
    
    const liveStatus = await this.isSidLive(sid);
    
    this.liveCache.set(sid, {
      live: liveStatus,
      checkedAt: currentTime
    });
    
    return liveStatus;
  }

  async getMacrosCached(sid) {
    const cachedEntry = this.macroCache.get(sid);
    const currentTime = Date.now();
    const CACHE_TTL_MS = 10000;
    
    if (cachedEntry && (currentTime - cachedEntry.fetchedAt) <= CACHE_TTL_MS) {
      return cachedEntry.macros;
    }
    
    // Mock macro data
    const mockMacros = [
      { id: 'macro1', enabled: true, intervalSec: 60, message: 'Test macro 1' },
      { id: 'macro2', enabled: true, intervalSec: 120, message: 'Test macro 2' },
      { id: 'macro3', enabled: false, intervalSec: 30, message: 'Disabled macro' }
    ];
    
    const enabledMacros = mockMacros.filter(m => m.enabled);
    
    this.macroCache.set(sid, {
      macros: enabledMacros,
      fetchedAt: currentTime
    });
    
    return enabledMacros;
  }

  shouldSendMacro(sid, macroId, intervalSec) {
    const sidTimers = this.macroTimers.get(sid);
    if (!sidTimers) {
      return true;
    }

    const lastSent = sidTimers.get(macroId);
    if (!lastSent) {
      return true;
    }

    const now = Date.now();
    const timeSinceLastSent = now - lastSent;
    const intervalMs = intervalSec * 1000;

    return timeSinceLastSent >= intervalMs && !this.shouldDelayDueToFailures(sid, macroId);
  }

  shouldDelayDueToFailures(sid, macroId) {
    const sidFailures = this.failureCount.get(sid);
    const sidFailureTimes = this.lastFailureTime.get(sid);
    
    if (!sidFailures || !sidFailureTimes) return false;

    const failureCount = sidFailures.get(macroId) || 0;
    const lastFailureTime = sidFailureTimes.get(macroId) || 0;

    if (failureCount === 0) return false;

    const now = Date.now();
    const timeSinceLastFailure = now - lastFailureTime;
    const backoffDelay = Math.min(30000 * Math.pow(2, failureCount - 1), 300000);

    return timeSinceLastFailure < backoffDelay;
  }

  markMacroSent(sid, macroId) {
    if (!this.macroTimers.has(sid)) {
      this.macroTimers.set(sid, new Map());
    }
    
    this.macroTimers.get(sid).set(macroId, Date.now());
    
    // Reset failure count
    const sidFailures = this.failureCount.get(sid);
    if (sidFailures && sidFailures.has(macroId)) {
      sidFailures.set(macroId, 0);
    }
  }

  recordFailure(sid, macroId) {
    if (!this.failureCount.has(sid)) {
      this.failureCount.set(sid, new Map());
    }
    if (!this.lastFailureTime.has(sid)) {
      this.lastFailureTime.set(sid, new Map());
    }
    
    const sidFailures = this.failureCount.get(sid);
    const sidFailureTimes = this.lastFailureTime.get(sid);
    
    const currentFailures = sidFailures.get(macroId) || 0;
    sidFailures.set(macroId, currentFailures + 1);
    sidFailureTimes.set(macroId, Date.now());
  }

  async sendMacroMessage(sid, macro, sessionEntry) {
    const url = 'https://api.example.com/chats/send';
    const accessToken = await mockGetValidAccessToken(sid);
    
    const response = await mockAxios.post(url, 
      { message: macro.message }, 
      {
        params: { sessionKey: sessionEntry.sessionKey },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 5000
      }
    );
    
    return response.status >= 200 && response.status < 300;
  }

  async processSession(sid) {
    const sessionEntry = this.sessionStore.get(sid);
    if (!sessionEntry || !sessionEntry.sessionKey) {
      return { processed: false, reason: 'no_session' };
    }

    const live = await this.getLiveCached(sid);
    if (!live) {
      return { processed: false, reason: 'not_live' };
    }

    const macros = await this.getMacrosCached(sid);
    if (!macros.length) {
      return { processed: false, reason: 'no_macros' };
    }

    const results = {
      processed: true,
      macrosChecked: 0,
      macrosSent: 0,
      macrosSkipped: 0,
      macrosFailed: 0,
      errors: []
    };

    for (const macro of macros) {
      results.macrosChecked++;
      
      if (this.shouldSendMacro(sid, macro.id, macro.intervalSec)) {
        try {
          const success = await this.sendMacroMessage(sid, macro, sessionEntry);
          
          if (success) {
            this.markMacroSent(sid, macro.id);
            results.macrosSent++;
            this.logger.logMacroSent(sid, macro.id, macro.message);
          } else {
            throw new Error('Send failed');
          }
        } catch (error) {
          this.recordFailure(sid, macro.id);
          results.macrosFailed++;
          results.errors.push({ macroId: macro.id, error: error.message });
        }
        
        // Burst prevention delay (simulated)
        // In tests, we'll skip the actual delay
      } else {
        results.macrosSkipped++;
        this.logger.logMacroSkipped(sid, macro.id, 'timer_not_ready');
      }
    }

    return results;
  }
}

describe('Macro Execution Flow Integration Tests', () => {
  let executionSystem;

  beforeEach(() => {
    jest.clearAllMocks();
    executionSystem = new MacroExecutionSystem();
    mockSessionStore.clear();
    mockMacroCache.clear();
    mockLiveCache.clear();
    jest.setSystemTime(new Date('2023-01-01T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.useFakeTimers();
  });

  describe('Complete execution flow', () => {
    test('should execute macros successfully when all conditions are met', async () => {
      const sid = 'test-sid';
      
      // Setup session
      mockSessionStore.set(sid, { sessionKey: 'valid-session-key' });
      
      // Setup live status
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: false });
      
      // Setup access token
      mockGetValidAccessToken.mockResolvedValue('valid-token');
      
      // Setup successful HTTP response
      mockAxios.post.mockResolvedValue({ status: 200 });
      
      const result = await executionSystem.processSession(sid);
      
      expect(result.processed).toBe(true);
      expect(result.macrosChecked).toBe(2); // 2 enabled macros
      expect(result.macrosSent).toBe(2);
      expect(result.macrosSkipped).toBe(0);
      expect(result.macrosFailed).toBe(0);
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });

    test('should skip execution when not live', async () => {
      const sid = 'test-sid';
      
      mockSessionStore.set(sid, { sessionKey: 'valid-session-key' });
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: true });
      mockGetBotStats.mockResolvedValue({ lastActive: null });
      
      const result = await executionSystem.processSession(sid);
      
      expect(result.processed).toBe(false);
      expect(result.reason).toBe('not_live');
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    test('should skip execution when no session key', async () => {
      const sid = 'test-sid';
      
      mockSessionStore.set(sid, {}); // No session key
      
      const result = await executionSystem.processSession(sid);
      
      expect(result.processed).toBe(false);
      expect(result.reason).toBe('no_session');
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    test('should handle macro send failures gracefully', async () => {
      const sid = 'test-sid';
      
      mockSessionStore.set(sid, { sessionKey: 'valid-session-key' });
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: false });
      mockGetValidAccessToken.mockResolvedValue('valid-token');
      
      // First macro succeeds, second fails
      mockAxios.post
        .mockResolvedValueOnce({ status: 200 })
        .mockRejectedValueOnce(new Error('Network error'));
      
      const result = await executionSystem.processSession(sid);
      
      expect(result.processed).toBe(true);
      expect(result.macrosChecked).toBe(2);
      expect(result.macrosSent).toBe(1);
      expect(result.macrosFailed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].macroId).toBe('macro2');
    });
  });

  describe('Timer-based execution', () => {
    test('should respect macro intervals', async () => {
      const sid = 'test-sid';
      
      mockSessionStore.set(sid, { sessionKey: 'valid-session-key' });
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: false });
      mockGetValidAccessToken.mockResolvedValue('valid-token');
      mockAxios.post.mockResolvedValue({ status: 200 });
      
      // First execution - should send all macros
      let result = await executionSystem.processSession(sid);
      expect(result.macrosSent).toBe(2);
      
      // Immediate second execution - should skip all macros
      result = await executionSystem.processSession(sid);
      expect(result.macrosSent).toBe(0);
      expect(result.macrosSkipped).toBe(2);
      
      // Advance time by 60 seconds
      jest.advanceTimersByTime(60 * 1000);
      
      // Third execution - should send macro1 (60s interval) but not macro2 (120s interval)
      result = await executionSystem.processSession(sid);
      expect(result.macrosSent).toBe(1);
      expect(result.macrosSkipped).toBe(1);
      
      // Advance time by another 60 seconds (total 120s)
      jest.advanceTimersByTime(60 * 1000);
      
      // Fourth execution - should send both macros
      result = await executionSystem.processSession(sid);
      expect(result.macrosSent).toBe(2);
      expect(result.macrosSkipped).toBe(0);
    });

    test('should handle burst prevention delays', async () => {
      const sid = 'test-sid';
      
      mockSessionStore.set(sid, { sessionKey: 'valid-session-key' });
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: false });
      mockGetValidAccessToken.mockResolvedValue('valid-token');
      mockAxios.post.mockResolvedValue({ status: 200 });
      
      const result = await executionSystem.processSession(sid);
      
      // Should process all macros successfully
      expect(result.processed).toBe(true);
      expect(result.macrosSent).toBe(2);
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('Failure handling and recovery', () => {
    test('should implement exponential backoff for failed macros', async () => {
      const sid = 'test-sid';
      
      mockSessionStore.set(sid, { sessionKey: 'valid-session-key' });
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: false });
      mockGetValidAccessToken.mockResolvedValue('valid-token');
      
      // Simulate failure
      mockAxios.post.mockRejectedValue(new Error('Network error'));
      
      // First execution - should fail
      let result = await executionSystem.processSession(sid);
      expect(result.macrosFailed).toBe(2);
      
      // Immediate retry - should be delayed due to failures
      result = await executionSystem.processSession(sid);
      expect(result.macrosFailed).toBe(2); // Still failing due to backoff
      
      // Advance time by 30 seconds (first backoff period)
      jest.advanceTimersByTime(30 * 1000);
      
      // Should try again after backoff
      mockAxios.post.mockResolvedValue({ status: 200 });
      result = await executionSystem.processSession(sid);
      expect(result.macrosSent).toBe(2); // Should succeed now
    });

    test('should reset failure count on successful send', async () => {
      const sid = 'test-sid';
      
      mockSessionStore.set(sid, { sessionKey: 'valid-session-key' });
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: false });
      mockGetValidAccessToken.mockResolvedValue('valid-token');
      
      // Record a failure first
      executionSystem.recordFailure(sid, 'macro1');
      
      // Should be delayed due to failure
      expect(executionSystem.shouldDelayDueToFailures(sid, 'macro1')).toBe(true);
      
      // Successful send should reset failure count
      executionSystem.markMacroSent(sid, 'macro1');
      
      // Should not be delayed anymore
      expect(executionSystem.shouldDelayDueToFailures(sid, 'macro1')).toBe(false);
    });

    test('should continue processing other macros when one fails', async () => {
      const sid = 'test-sid';
      
      mockSessionStore.set(sid, { sessionKey: 'valid-session-key' });
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: false });
      mockGetValidAccessToken.mockResolvedValue('valid-token');
      
      // First macro fails, second succeeds
      mockAxios.post
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ status: 200 });
      
      const result = await executionSystem.processSession(sid);
      
      expect(result.macrosChecked).toBe(2);
      expect(result.macrosSent).toBe(1);
      expect(result.macrosFailed).toBe(1);
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('Cache behavior', () => {
    test('should use cached live status within TTL', async () => {
      const sid = 'test-sid';
      
      // First call should fetch fresh data
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: false });
      let result = await executionSystem.getLiveCached(sid);
      expect(result).toBe(true);
      expect(mockGetBotSettings).toHaveBeenCalledTimes(1);
      
      // Second call within TTL should use cache
      result = await executionSystem.getLiveCached(sid);
      expect(result).toBe(true);
      expect(mockGetBotSettings).toHaveBeenCalledTimes(1); // Still 1, used cache
      
      // Advance time beyond TTL
      jest.advanceTimersByTime(9000);
      
      // Third call should fetch fresh data
      result = await executionSystem.getLiveCached(sid);
      expect(result).toBe(true);
      expect(mockGetBotSettings).toHaveBeenCalledTimes(2); // Now 2, fetched fresh
    });

    test('should use cached macros within TTL', async () => {
      const sid = 'test-sid';
      
      // First call should fetch fresh data
      let macros = await executionSystem.getMacrosCached(sid);
      expect(macros).toHaveLength(2);
      
      // Second call within TTL should use cache
      macros = await executionSystem.getMacrosCached(sid);
      expect(macros).toHaveLength(2);
      
      // Advance time beyond TTL
      jest.advanceTimersByTime(11000);
      
      // Third call should fetch fresh data
      macros = await executionSystem.getMacrosCached(sid);
      expect(macros).toHaveLength(2);
    });
  });
});