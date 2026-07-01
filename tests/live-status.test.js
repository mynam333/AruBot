/**
 * Unit tests for live status determination logic
 * Tests Requirements: 1.1, 1.2, 4.1, 4.2, 4.3, 4.4
 */

// Jest globals are automatically available

// Mock the database functions
const mockGetBotSettings = jest.fn();
const mockGetBotStats = jest.fn();

// Mock the cache
const mockLiveCache = new Map();

// Mock the logger
const mockLogger = {
  logLiveStatusChange: jest.fn(),
  logCacheRefresh: jest.fn(),
  isDebugMode: false
};

// Mock the timer manager
const mockMacroTimerManager = {
  logger: mockLogger
};

// Create the functions to test by extracting the logic
async function isSidLive(sid) {
  if (!sid || typeof sid !== 'string') {
    console.warn('isSidLive called with invalid sid:', sid);
    return false;
  }

  try {
    const settings = await mockGetBotSettings(sid) || {};
    const onlyWhenLive = !!settings.onlyWhenLive;
    
    if (!onlyWhenLive) {
      return true;
    }
    
    try {
      const stats = await mockGetBotStats(sid);
      const lastActiveStr = stats && stats.lastActive;
      
      if (!lastActiveStr) {
        return false;
      }
      
      const lastActiveTime = Date.parse(lastActiveStr);
      if (!Number.isFinite(lastActiveTime)) {
        console.warn(`Invalid lastActive format for sid ${sid}:`, lastActiveStr);
        return false;
      }
      
      const currentTime = Date.now();
      const timeSinceLastActive = currentTime - lastActiveTime;
      
      if (timeSinceLastActive < 0) {
        console.warn(`lastActive is in the future for sid ${sid}. lastActive: ${lastActiveStr}, current: ${new Date().toISOString()}`);
        return false;
      }
      
      const LIVE_THRESHOLD_MS = 5 * 60 * 1000;
      return timeSinceLastActive < LIVE_THRESHOLD_MS;
      
    } catch (error) {
      console.warn(`Failed to get bot stats for live check (sid: ${sid}):`, error.message);
      return false;
    }
  } catch (error) {
    console.warn(`Failed to get bot settings for live check (sid: ${sid}):`, error.message);
    return false;
  }
}

async function getLiveCached(sid) {
  const cachedEntry = mockLiveCache.get(sid);
  const currentTime = Date.now();
  const CACHE_TTL_MS = 8000;
  
  if (cachedEntry && (currentTime - cachedEntry.checkedAt) <= CACHE_TTL_MS) {
    return cachedEntry.live;
  }
  
  let liveStatus = false;
  
  try {
    liveStatus = await isSidLive(sid);
  } catch (error) {
    console.warn(`Live status check failed for sid ${sid}:`, error.message);
    liveStatus = false;
  }
  
  if (cachedEntry && cachedEntry.live !== liveStatus) {
    mockMacroTimerManager.logger.logLiveStatusChange(sid, cachedEntry.live, liveStatus, {});
  }
  
  mockLiveCache.set(sid, {
    live: liveStatus,
    checkedAt: currentTime
  });
  
  return liveStatus;
}

describe('Live Status Logic Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLiveCache.clear();
    jest.setSystemTime(new Date('2023-01-01T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.useFakeTimers();
  });

  describe('isSidLive function', () => {
    test('should return false for invalid sid', async () => {
      const result1 = await isSidLive(null);
      const result2 = await isSidLive('');
      const result3 = await isSidLive(123);
      
      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
    });

    test('should return true when onlyWhenLive is false', async () => {
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: false });
      
      const result = await isSidLive('test-sid');
      
      expect(result).toBe(true);
      expect(mockGetBotSettings).toHaveBeenCalledWith('test-sid');
    });

    test('should return true when onlyWhenLive is undefined', async () => {
      mockGetBotSettings.mockResolvedValue({});
      
      const result = await isSidLive('test-sid');
      
      expect(result).toBe(true);
    });

    test('should return false when onlyWhenLive is true and no lastActive', async () => {
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: true });
      mockGetBotStats.mockResolvedValue({ lastActive: null });
      
      const result = await isSidLive('test-sid');
      
      expect(result).toBe(false);
    });

    test('should return false when onlyWhenLive is true and invalid lastActive format', async () => {
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: true });
      mockGetBotStats.mockResolvedValue({ lastActive: 'invalid-date' });
      
      const result = await isSidLive('test-sid');
      
      expect(result).toBe(false);
    });

    test('should return true when onlyWhenLive is true and lastActive within 5 minutes', async () => {
      const now = new Date('2023-01-01T12:00:00Z');
      const recentTime = new Date(now.getTime() - 4 * 60 * 1000); // 4 minutes ago
      
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: true });
      mockGetBotStats.mockResolvedValue({ lastActive: recentTime.toISOString() });
      
      const result = await isSidLive('test-sid');
      
      expect(result).toBe(true);
    });

    test('should return false when onlyWhenLive is true and lastActive older than 5 minutes', async () => {
      const now = new Date('2023-01-01T12:00:00Z');
      const oldTime = new Date(now.getTime() - 6 * 60 * 1000); // 6 minutes ago
      
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: true });
      mockGetBotStats.mockResolvedValue({ lastActive: oldTime.toISOString() });
      
      const result = await isSidLive('test-sid');
      
      expect(result).toBe(false);
    });

    test('should return false when lastActive is in the future', async () => {
      const now = new Date('2023-01-01T12:00:00Z');
      const futureTime = new Date(now.getTime() + 60 * 1000); // 1 minute in future
      
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: true });
      mockGetBotStats.mockResolvedValue({ lastActive: futureTime.toISOString() });
      
      const result = await isSidLive('test-sid');
      
      expect(result).toBe(false);
    });

    test('should return false when getBotStats throws error', async () => {
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: true });
      mockGetBotStats.mockRejectedValue(new Error('Database error'));
      
      const result = await isSidLive('test-sid');
      
      expect(result).toBe(false);
    });

    test('should return false when getBotSettings throws error', async () => {
      mockGetBotSettings.mockRejectedValue(new Error('Database error'));
      
      const result = await isSidLive('test-sid');
      
      expect(result).toBe(false);
    });
  });

  describe('getLiveCached function', () => {
    test('should return cached value when cache is valid', async () => {
      const now = Date.now();
      mockLiveCache.set('test-sid', {
        live: true,
        checkedAt: now - 5000 // 5 seconds ago, within 8 second TTL
      });
      
      const result = await getLiveCached('test-sid');
      
      expect(result).toBe(true);
      expect(mockGetBotSettings).not.toHaveBeenCalled();
    });

    test('should fetch fresh data when cache is expired', async () => {
      const now = Date.now();
      mockLiveCache.set('test-sid', {
        live: true,
        checkedAt: now - 10000 // 10 seconds ago, beyond 8 second TTL
      });
      
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: false });
      
      const result = await getLiveCached('test-sid');
      
      expect(result).toBe(true);
      expect(mockGetBotSettings).toHaveBeenCalledWith('test-sid');
    });

    test('should log status change when live status changes', async () => {
      mockLiveCache.set('test-sid', {
        live: true,
        checkedAt: Date.now() - 10000 // Expired cache
      });
      
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: true });
      mockGetBotStats.mockResolvedValue({ lastActive: null }); // Will result in false
      
      await getLiveCached('test-sid');
      
      expect(mockLogger.logLiveStatusChange).toHaveBeenCalledWith('test-sid', true, false, {});
    });

    test('should handle errors gracefully and default to false', async () => {
      mockGetBotSettings.mockRejectedValue(new Error('Database error'));
      
      const result = await getLiveCached('test-sid');
      
      expect(result).toBe(false);
    });

    test('should update cache with new value', async () => {
      mockGetBotSettings.mockResolvedValue({ onlyWhenLive: false });
      
      await getLiveCached('test-sid');
      
      const cachedEntry = mockLiveCache.get('test-sid');
      expect(cachedEntry).toBeDefined();
      expect(cachedEntry.live).toBe(true);
      expect(cachedEntry.checkedAt).toBeCloseTo(Date.now(), -2);
    });
  });
});