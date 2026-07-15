const path = require('path');
const { execFileSync } = require('child_process');

describe('runtime recovery supervisor', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL(
      '../server/runtime-recovery.js',
      `file://${__filename.replace(/\\/g, '/')}`,
    ).href;
    const script = `
      const { createRuntimeRecoverySupervisor, calculateRecoveryDelay } = await import(${JSON.stringify(moduleUrl)});

      function createTimerHarness() {
        let nextId = 1;
        const timers = new Map();
        return {
          setTimer(callback, delay) {
            const handle = { id: nextId++, unref() {} };
            timers.set(handle.id, { callback, delay, handle });
            return handle;
          },
          clearTimer(handle) {
            timers.delete(handle?.id);
          },
          delays() {
            return Array.from(timers.values(), (timer) => timer.delay);
          },
          async runNext() {
            const first = timers.entries().next();
            if (first.done) throw new Error('No timer is scheduled');
            const [id, timer] = first.value;
            timers.delete(id);
            timer.callback();
            await new Promise((resolve) => setImmediate(resolve));
          },
          size() {
            return timers.size;
          },
        };
      }

      const output = {};

      {
        const timer = createTimerHarness();
        let release;
        let taskCalls = 0;
        let ignoredCalls = 0;
        const supervisor = createRuntimeRecoverySupervisor({
          setTimer: timer.setTimer,
          clearTimer: timer.clearTimer,
          random: () => 0.5,
        });
        const task = () => {
          taskCalls += 1;
          return new Promise((resolve) => { release = resolve; });
        };
        const ignoredTask = () => { ignoredCalls += 1; };
        supervisor.schedule('youtube:owner-1', task);
        const duplicate = supervisor.schedule('youtube:owner-1', ignoredTask);
        const scheduledTimerCount = timer.size();
        await timer.runNext();
        const running = supervisor.getState('youtube:owner-1')?.running === true;
        supervisor.schedule('youtube:owner-1', ignoredTask);
        release();
        await new Promise((resolve) => setImmediate(resolve));
        output.dedupe = {
          duplicateAttempt: duplicate.attempt,
          scheduledTimerCount,
          taskCalls,
          ignoredCalls,
          running,
          removedAfterSuccess: supervisor.getState('youtube:owner-1') === null,
        };
      }

      output.delays = {
        low: calculateRecoveryDelay({ attempt: 1, random: () => 0 }),
        midpoint: calculateRecoveryDelay({ attempt: 1, random: () => 0.5 }),
        high: calculateRecoveryDelay({ attempt: 1, random: () => 1 }),
        second: calculateRecoveryDelay({ attempt: 2, random: () => 0.5 }),
        capped: calculateRecoveryDelay({ attempt: 20, random: () => 1 }),
      };

      {
        const timer = createTimerHarness();
        let calls = 0;
        const task = async () => {
          calls += 1;
          if (calls <= 2) throw new Error('temporary-' + calls);
          return 'connected';
        };
        const supervisor = createRuntimeRecoverySupervisor({
          setTimer: timer.setTimer,
          clearTimer: timer.clearTimer,
          random: () => 0.5,
        });
        supervisor.schedule('cime:owner-1', task);
        const delaySequence = [timer.delays()[0]];
        await timer.runNext();
        const firstFailure = supervisor.getState('cime:owner-1');
        delaySequence.push(timer.delays()[0]);
        await timer.runNext();
        const secondFailure = supervisor.getState('cime:owner-1');
        delaySequence.push(timer.delays()[0]);
        await timer.runNext();
        output.retry = {
          calls,
          delaySequence,
          firstFailure,
          secondFailure,
          removedAfterSuccess: supervisor.getState('cime:owner-1') === null,
          timerCount: timer.size(),
        };
      }

      {
        const timer = createTimerHarness();
        let predicateCalls = 0;
        const supervisor = createRuntimeRecoverySupervisor({
          setTimer: timer.setTimer,
          clearTimer: timer.clearTimer,
          random: () => 0.5,
        });
        supervisor.schedule('youtube:terminal', async () => { throw new Error('invalid_grant'); }, {
          shouldRetry() {
            predicateCalls += 1;
            return false;
          },
        });
        await timer.runNext();
        const predicateStopped = supervisor.getState('youtube:terminal') === null;
        const terminalError = new Error('channel disconnected');
        terminalError.shouldRetry = false;
        supervisor.schedule('cime:terminal', async () => { throw terminalError; });
        await timer.runNext();
        output.terminal = {
          predicateCalls,
          predicateStopped,
          errorFlagStopped: supervisor.getState('cime:terminal') === null,
          timerCount: timer.size(),
        };
      }

      {
        const timer = createTimerHarness();
        const supervisor = createRuntimeRecoverySupervisor({
          setTimer: timer.setTimer,
          clearTimer: timer.clearTimer,
          random: () => 0.5,
        });
        supervisor.schedule('chzzk:one', async () => {});
        supervisor.schedule('cime:two', async () => {});
        const listed = supervisor.listStates();
        const firstCancel = supervisor.cancel('chzzk:one');
        const duplicateCancel = supervisor.cancel('chzzk:one');
        const timerCountAfterOne = timer.size();
        const cancelledAll = supervisor.cancelAll();
        output.cancellation = {
          listed,
          firstCancel,
          duplicateCancel,
          timerCountAfterOne,
          cancelledAll,
          finalStates: supervisor.listStates(),
          finalTimerCount: timer.size(),
        };
      }

      {
        const timer = createTimerHarness();
        let rejectTask;
        const supervisor = createRuntimeRecoverySupervisor({
          setTimer: timer.setTimer,
          clearTimer: timer.clearTimer,
          random: () => 0.5,
        });
        supervisor.schedule('youtube:running', () => new Promise((resolve, reject) => { rejectTask = reject; }));
        await timer.runNext();
        const cancelled = supervisor.cancel('youtube:running');
        rejectTask(new Error('late failure'));
        await new Promise((resolve) => setImmediate(resolve));
        output.runningCancellation = {
          cancelled,
          state: supervisor.getState('youtube:running'),
          timerCount: timer.size(),
        };
      }

      {
        const timer = createTimerHarness();
        const supervisor = createRuntimeRecoverySupervisor({
          setTimer: timer.setTimer,
          clearTimer: timer.clearTimer,
          random: () => 0.5,
        });
        supervisor.schedule('youtube:standby', async () => {
          const error = new Error('not_live');
          error.retryAfterMs = 300000;
          throw error;
        }, { initialDelayMs: 60000 });
        const initialDelay = timer.delays()[0];
        await timer.runNext();
        output.customDelay = {
          initialDelay,
          retryDelay: timer.delays()[0],
          lastError: supervisor.getState('youtube:standby')?.lastError,
        };
      }

      console.log(JSON.stringify(output));
    `;

    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());
  });

  test('deduplicates scheduled and running work by key', () => {
    expect(result.dedupe).toEqual({
      duplicateAttempt: 0,
      scheduledTimerCount: 1,
      taskCalls: 1,
      ignoredCalls: 0,
      running: true,
      removedAfterSuccess: true,
    });
  });

  test('uses capped exponential backoff with ±20% injected jitter', () => {
    expect(result.delays).toEqual({ low: 800, midpoint: 1000, high: 1200, second: 2000, capped: 60000 });
  });

  test('automatically reschedules failures and removes state after success', () => {
    expect(result.retry.calls).toBe(3);
    expect(result.retry.delaySequence).toEqual([1000, 2000, 4000]);
    expect(result.retry.firstFailure).toMatchObject({ attempt: 1, nextAttempt: 2, nextDelayMs: 2000, lastError: 'temporary-1' });
    expect(result.retry.secondFailure).toMatchObject({ attempt: 2, nextAttempt: 3, nextDelayMs: 4000, lastError: 'temporary-2' });
    expect(result.retry.removedAfterSuccess).toBe(true);
    expect(result.retry.timerCount).toBe(0);
  });

  test('stops when shouldRetry returns false or an error opts out', () => {
    expect(result.terminal).toEqual({ predicateCalls: 1, predicateStopped: true, errorFlagStopped: true, timerCount: 0 });
  });

  test('supports state inspection, individual cancellation, and cancelAll', () => {
    expect(result.cancellation.listed).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'chzzk:one', status: 'scheduled', nextDelayMs: 1000 }),
      expect.objectContaining({ key: 'cime:two', status: 'scheduled', nextDelayMs: 1000 }),
    ]));
    expect(result.cancellation).toMatchObject({
      firstCancel: true,
      duplicateCancel: false,
      timerCountAfterOne: 1,
      cancelledAll: 1,
      finalStates: [],
      finalTimerCount: 0,
    });
  });

  test('cancelling running work prevents a late failure from rescheduling', () => {
    expect(result.runningCancellation).toEqual({ cancelled: true, state: null, timerCount: 0 });
  });

  test('honors provider standby and retry-after delays', () => {
    expect(result.customDelay).toEqual({ initialDelay: 60000, retryDelay: 300000, lastError: 'not_live' });
  });
});
