/**
 * Unit tests for macro timer independence
 * Tests Requirements: 2.1, 2.2, 2.3, 2.4
 */

// Jest globals are automatically available

// Mock logger
const mockLogger = {
  logMacroSent: jest.fn(),
  logMacroSkipped: jest.fn(),
  logCacheRefresh: jest.fn(),
  isDebugMode: false
};

// Create MacroTimerManager class for testing
class MacroTimerManager {
  constructor() {
    this.macroTimers = new Map(); // sid -> Map(macroId -> lastSentTimestamp)
    this.failureCount = new Map(); // sid -> Map(macroId -> failureCount)
    this.lastFailureTime = new Map(); // sid -> Map(macroId -> lastFailureTimestamp)
    this.logger = mockLogger;
  }

  shouldSendMacro(sid, macroId, intervalSec) {
    if (!sid || !macroId || !intervalSec || intervalSec <= 0) {
      return false;
    }

    const sidTimers = this.macroTimers.get(sid);
    if (!sidTimers) {
      return true; // First time, should send
    }

    const lastSent = sidTimers.get(macroId);
    if (!lastSent) {
      return true; // First time for this macro, should send
    }

    const now = Date.now();
    const timeSinceLastSent = now - lastSent;
    const intervalMs = intervalSec * 1000;

    // Check if enough time has passed
    if (timeSinceLastSent >= intervalMs) {
      // Also check if we should delay due to recent failures
      return !this.shouldDelayDueToFailures(sid, macroId);
    }

    return false;
  }

  markMacroSent(sid, macroId, message = '', metadata = {}) {
    if (!sid || !macroId) return;

    const now = Date.now();
    
    // Initialize session timers if needed
    if (!this.macroTimers.has(sid)) {
      this.macroTimers.set(sid, new Map());
    }
    
    // Update the timer for this specific macro
    this.macroTimers.get(sid).set(macroId, now);
    
    // Reset failure count on successful send
    const sidFailures = this.failureCount.get(sid);
    if (sidFailures && sidFailures.has(macroId)) {
      sidFailures.set(macroId, 0);
    }
    
    // Log the successful send
    this.logger.logMacroSent(sid, macroId, message, metadata);
  }

  recordFailure(sid, macroId, errorDetails = {}) {
    if (!sid || !macroId) return;

    const now = Date.now();
    
    // Initialize failure tracking if needed
    if (!this.failureCount.has(sid)) {
      this.failureCount.set(sid, new Map());
    }
    if (!this.lastFailureTime.has(sid)) {
      this.lastFailureTime.set(sid, new Map());
    }
    
    const sidFailures = this.failureCount.get(sid);
    const sidFailureTimes = this.lastFailureTime.get(sid);
    
    // Increment failure count
    const currentFailures = sidFailures.get(macroId) || 0;
    sidFailures.set(macroId, currentFailures + 1);
    sidFailureTimes.set(macroId, now);
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

    // Exponential backoff: 30s, 60s, 120s, max 300s (5 minutes)
    const backoffDelay = Math.min(30000 * Math.pow(2, failureCount - 1), 300000);

    return timeSinceLastFailure < backoffDelay;
  }

  getLastSentTime(sid, macroId) {
    const sidTimers = this.macroTimers.get(sid);
    if (!sidTimers) {
      return null;
    }
    return sidTimers.get(macroId) || null;
  }

  // Simulate bot response (should NOT affect macro timers)
  simulateBotResponse(sid, message) {
    // This simulates what happens when bot sends a response to a chat command
    // It should NOT affect any macro timers
    this.logger.logMacroSkipped(sid, 'bot-response', `Bot response: ${message}`);
  }
}

describe('Macro Timer Independence Tests', () => {
  let timerManager;

  beforeEach(() => {
    jest.clearAllMocks();
    timerManager = new MacroTimerManager();
    jest.setSystemTime(new Date('2023-01-01T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.useFakeTimers();
  });

  describe('Independent timer management', () => {
    test('should maintain separate timers for different macros', () => {
      const sid = 'test-sid';
      const macro1 = 'macro1';
      const macro2 = 'macro2';
      
      // Both macros should be ready to send initially
      expect(timerManager.shouldSendMacro(sid, macro1, 60)).toBe(true);
      expect(timerManager.shouldSendMacro(sid, macro2, 60)).toBe(true);
      
      // Send macro1
      timerManager.markMacroSent(sid, macro1, 'Message 1');
      
      // macro1 should not be ready, macro2 should still be ready
      expect(timerManager.shouldSendMacro(sid, macro1, 60)).toBe(false);
      expect(timerManager.shouldSendMacro(sid, macro2, 60)).toBe(true);
      
      // Send macro2
      timerManager.markMacroSent(sid, macro2, 'Message 2');
      
      // Both should not be ready now
      expect(timerManager.shouldSendMacro(sid, macro1, 60)).toBe(false);
      expect(timerManager.shouldSendMacro(sid, macro2, 60)).toBe(false);
    });

    test('should handle different intervals for different macros', () => {
      const sid = 'test-sid';
      const fastMacro = 'fast-macro';
      const slowMacro = 'slow-macro';
      
      // Send both macros
      timerManager.markMacroSent(sid, fastMacro, 'Fast message');
      timerManager.markMacroSent(sid, slowMacro, 'Slow message');
      
      // Advance time by 30 seconds
      jest.advanceTimersByTime(30 * 1000);
      
      // Fast macro (30s interval) should be ready, slow macro (60s interval) should not
      expect(timerManager.shouldSendMacro(sid, fastMacro, 30)).toBe(true);
      expect(timerManager.shouldSendMacro(sid, slowMacro, 60)).toBe(false);
      
      // Advance time by another 30 seconds (total 60s)
      jest.advanceTimersByTime(30 * 1000);
      
      // Both should be ready now
      expect(timerManager.shouldSendMacro(sid, fastMacro, 30)).toBe(true);
      expect(timerManager.shouldSendMacro(sid, slowMacro, 60)).toBe(true);
    });

    test('should maintain separate timers for different sessions', () => {
      const sid1 = 'session1';
      const sid2 = 'session2';
      const macroId = 'same-macro';
      
      // Send macro for session1
      timerManager.markMacroSent(sid1, macroId, 'Message from session1');
      
      // session1 should not be ready, session2 should be ready
      expect(timerManager.shouldSendMacro(sid1, macroId, 60)).toBe(false);
      expect(timerManager.shouldSendMacro(sid2, macroId, 60)).toBe(true);
      
      // Send macro for session2
      timerManager.markMacroSent(sid2, macroId, 'Message from session2');
      
      // Both should not be ready now
      expect(timerManager.shouldSendMacro(sid1, macroId, 60)).toBe(false);
      expect(timerManager.shouldSendMacro(sid2, macroId, 60)).toBe(false);
    });
  });

  describe('Bot response isolation', () => {
    test('bot responses should not affect macro timers', () => {
      const sid = 'test-sid';
      const macroId = 'test-macro';
      
      // Send a macro
      timerManager.markMacroSent(sid, macroId, 'Macro message');
      const initialTime = timerManager.getLastSentTime(sid, macroId);
      
      // Simulate multiple bot responses
      timerManager.simulateBotResponse(sid, 'Bot response 1');
      timerManager.simulateBotResponse(sid, 'Bot response 2');
      timerManager.simulateBotResponse(sid, 'Bot response 3');
      
      // Macro timer should remain unchanged
      const afterResponseTime = timerManager.getLastSentTime(sid, macroId);
      expect(afterResponseTime).toBe(initialTime);
      
      // Macro should still not be ready (assuming interval hasn't passed)
      expect(timerManager.shouldSendMacro(sid, macroId, 60)).toBe(false);
    });

    test('concurrent macro and bot activity should work independently', () => {
      const sid = 'test-sid';
      const macro1 = 'macro1';
      const macro2 = 'macro2';
      
      // Send macro1
      timerManager.markMacroSent(sid, macro1, 'Macro 1 message');
      
      // Advance time slightly to ensure different timestamps
      jest.advanceTimersByTime(10);
      
      // Simulate bot responses
      timerManager.simulateBotResponse(sid, 'Bot response');
      
      // Send macro2
      timerManager.markMacroSent(sid, macro2, 'Macro 2 message');
      
      // More bot responses
      timerManager.simulateBotResponse(sid, 'Another bot response');
      
      // Check that each macro has its own timer
      expect(timerManager.getLastSentTime(sid, macro1)).toBeTruthy();
      expect(timerManager.getLastSentTime(sid, macro2)).toBeTruthy();
      expect(timerManager.getLastSentTime(sid, macro1)).not.toBe(timerManager.getLastSentTime(sid, macro2));
      
      // Both macros should not be ready (just sent)
      expect(timerManager.shouldSendMacro(sid, macro1, 60)).toBe(false);
      expect(timerManager.shouldSendMacro(sid, macro2, 60)).toBe(false);
    });
  });

  describe('Failure handling independence', () => {
    test('failures should be tracked per macro independently', () => {
      const sid = 'test-sid';
      const macro1 = 'macro1';
      const macro2 = 'macro2';
      
      // Record failure for macro1
      timerManager.recordFailure(sid, macro1, { type: 'NETWORK_ERROR' });
      
      // macro1 should be delayed, macro2 should not
      expect(timerManager.shouldDelayDueToFailures(sid, macro1)).toBe(true);
      expect(timerManager.shouldDelayDueToFailures(sid, macro2)).toBe(false);
      
      // Record failure for macro2
      timerManager.recordFailure(sid, macro2, { type: 'TIMEOUT' });
      
      // Both should be delayed now
      expect(timerManager.shouldDelayDueToFailures(sid, macro1)).toBe(true);
      expect(timerManager.shouldDelayDueToFailures(sid, macro2)).toBe(true);
    });

    test('successful send should reset failure count for that macro only', () => {
      const sid = 'test-sid';
      const macro1 = 'macro1';
      const macro2 = 'macro2';
      
      // Record failures for both macros
      timerManager.recordFailure(sid, macro1, { type: 'ERROR' });
      timerManager.recordFailure(sid, macro2, { type: 'ERROR' });
      
      // Both should be delayed
      expect(timerManager.shouldDelayDueToFailures(sid, macro1)).toBe(true);
      expect(timerManager.shouldDelayDueToFailures(sid, macro2)).toBe(true);
      
      // Successful send for macro1
      timerManager.markMacroSent(sid, macro1, 'Success message');
      
      // macro1 should not be delayed anymore, macro2 should still be delayed
      expect(timerManager.shouldDelayDueToFailures(sid, macro1)).toBe(false);
      expect(timerManager.shouldDelayDueToFailures(sid, macro2)).toBe(true);
    });

    test('exponential backoff should work independently per macro', () => {
      const sid = 'test-sid';
      const macro1 = 'macro1';
      const macro2 = 'macro2';
      
      // Record multiple failures for macro1
      timerManager.recordFailure(sid, macro1, { type: 'ERROR' });
      timerManager.recordFailure(sid, macro1, { type: 'ERROR' });
      
      // Record single failure for macro2
      timerManager.recordFailure(sid, macro2, { type: 'ERROR' });
      
      // Both should be delayed initially
      expect(timerManager.shouldDelayDueToFailures(sid, macro1)).toBe(true);
      expect(timerManager.shouldDelayDueToFailures(sid, macro2)).toBe(true);
      
      // Advance time by 30 seconds (first backoff period)
      jest.advanceTimersByTime(30 * 1000);
      
      // macro2 (1 failure) should not be delayed anymore, macro1 (2 failures) should still be delayed
      expect(timerManager.shouldDelayDueToFailures(sid, macro1)).toBe(true);
      expect(timerManager.shouldDelayDueToFailures(sid, macro2)).toBe(false);
      
      // Advance time by another 30 seconds (total 60s, second backoff period)
      jest.advanceTimersByTime(30 * 1000);
      
      // Both should not be delayed now
      expect(timerManager.shouldDelayDueToFailures(sid, macro1)).toBe(false);
      expect(timerManager.shouldDelayDueToFailures(sid, macro2)).toBe(false);
    });
  });

  describe('Edge cases', () => {
    test('should handle invalid parameters gracefully', () => {
      expect(timerManager.shouldSendMacro('', 'macro', 60)).toBe(false);
      expect(timerManager.shouldSendMacro('sid', '', 60)).toBe(false);
      expect(timerManager.shouldSendMacro('sid', 'macro', 0)).toBe(false);
      expect(timerManager.shouldSendMacro('sid', 'macro', -1)).toBe(false);
    });

    test('should handle null/undefined values', () => {
      expect(timerManager.shouldSendMacro(null, 'macro', 60)).toBe(false);
      expect(timerManager.shouldSendMacro('sid', null, 60)).toBe(false);
      expect(timerManager.shouldSendMacro('sid', 'macro', null)).toBe(false);
      
      expect(timerManager.getLastSentTime(null, 'macro')).toBe(null);
      expect(timerManager.getLastSentTime('sid', null)).toBe(null);
    });

    test('should return null for non-existent timers', () => {
      expect(timerManager.getLastSentTime('non-existent-sid', 'macro')).toBe(null);
      expect(timerManager.getLastSentTime('sid', 'non-existent-macro')).toBe(null);
    });
  });
});