// Test setup file
// Mock console methods to reduce noise during testing
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
  log: jest.fn()
};

// Do not enable fake timers globally. Several integration tests import server
// modules and rely on real timers, sockets, and async cleanup.
