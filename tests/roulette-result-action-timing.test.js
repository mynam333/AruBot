const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

describe('roulette result action timing', () => {
  let coordinatorResult;

  beforeAll(() => {
    const moduleUrl = new URL('../server/roulette-result-action-coordinator.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const { createRouletteResultActionCoordinator } = await import(${JSON.stringify(moduleUrl)});
      let now = 1_000;
      const timers = [];
      const executions = [];
      const coordinator = createRouletteResultActionCoordinator({
        now: () => now,
        setTimeoutFn: (callback, delayMs) => {
          const timer = { callback, delayMs, cancelled: false, unref() {} };
          timers.push(timer);
          return timer;
        },
        clearTimeoutFn: (timer) => { timer.cancelled = true; },
      });

      const registered = coordinator.register({
        token: 'roulette_token_123456',
        spinId: 'spin_1234567890',
        channelId: 'channel-1',
        label: '당첨',
        notBefore: 2_000,
        fallbackDelayMs: 5_000,
        execute: ({ reason }) => { executions.push(reason); },
      });
      const wrongChannel = await coordinator.settle({
        token: 'roulette_token_123456', spinId: 'spin_1234567890', channelId: 'channel-2', label: '당첨',
      });
      const wrongLabel = await coordinator.settle({
        token: 'roulette_token_123456', spinId: 'spin_1234567890', channelId: 'channel-1', label: '꽝',
      });
      const tooEarly = await coordinator.settle({
        token: 'roulette_token_123456', spinId: 'spin_1234567890', channelId: 'channel-1', label: '당첨',
      });
      now = 2_100;
      const settled = await coordinator.settle({
        token: 'roulette_token_123456', spinId: 'spin_1234567890', channelId: 'channel-1', label: '당첨',
      });
      const duplicate = await coordinator.settle({
        token: 'roulette_token_123456', spinId: 'spin_1234567890', channelId: 'channel-1', label: '당첨',
      });

      coordinator.register({
        token: 'roulette_token_123456',
        spinId: 'spin_fallback_123',
        channelId: 'channel-1',
        label: '보상',
        fallbackDelayMs: 500,
        execute: ({ reason }) => { executions.push(reason); },
      });
      now = 2_600;
      timers.find((timer) => timer.delayMs === 500).callback();
      await new Promise((resolve) => setImmediate(resolve));

      coordinator.register({
        token: 'roulette_token_123456',
        spinId: 'spin_release_1234',
        channelId: 'channel-1',
        label: '보상',
        execute: ({ reason }) => { executions.push(reason); },
      });
      const released = await coordinator.release(
        { token: 'roulette_token_123456', spinId: 'spin_release_1234' },
        'overlay-unavailable',
      );

      console.log(JSON.stringify({
        registered,
        wrongChannel: wrongChannel.status,
        wrongLabel: wrongLabel.status,
        tooEarly: tooEarly.status,
        settled: settled.status,
        duplicate: duplicate.status,
        released: released.status,
        executions,
        firstTimerCancelled: timers[0].cancelled,
        pendingCount: coordinator.pendingCount(),
      }));
    `;

    coordinatorResult = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
    }).trim());
  });

  test('accepts only a matching, timely overlay settlement and executes exactly once', () => {
    expect(coordinatorResult).toMatchObject({
      registered: true,
      wrongChannel: 'channel-mismatch',
      wrongLabel: 'label-mismatch',
      tooEarly: 'too-early',
      settled: 'executed',
      duplicate: 'missing',
      released: 'executed',
      firstTimerCancelled: true,
      pendingCount: 0,
    });
    expect(coordinatorResult.executions).toEqual([
      'overlay-settled',
      'settlement-timeout',
      'overlay-unavailable',
    ]);
  });

  test('server defers result actions until the authenticated overlay settles', () => {
    const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
    const start = serverIndex.indexOf('async function startRouletteSpin');
    const end = serverIndex.indexOf('async function executeRouletteResultCommand', start);
    const spinBody = serverIndex.slice(start, end);
    const websocketStart = serverIndex.indexOf('function registerRouletteRoutes');
    const websocketEnd = serverIndex.indexOf('try { registerRouletteRoutes()', websocketStart);
    const websocketBody = serverIndex.slice(websocketStart, websocketEnd);

    expect(spinBody).not.toContain('await executeActionVariableTokens');
    expect(spinBody.indexOf('rouletteResultActionCoordinator.register({')).toBeGreaterThan(-1);
    expect(spinBody.indexOf('rouletteResultActionCoordinator.register({'))
      .toBeLessThan(spinBody.indexOf('deliverRouletteBroadcast({'));
    expect(websocketBody).toContain("message?.type !== 'roulette:settled'");
    expect(websocketBody).toContain('rouletteResultActionCoordinator.settle({');
    expect(websocketBody).toContain('token,');
    expect(websocketBody).toContain('channelId,');
  });

  test('overlay acknowledges only after the final result has been painted', () => {
    const viewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'RouletteViewer.tsx'), 'utf8');

    expect(viewer).toContain("type: 'roulette:settled'");
    expect(viewer).toContain('socket.send(JSON.stringify({');
    expect(viewer).toContain('window.requestAnimationFrame(() => {');
    expect(viewer).toContain('window.requestAnimationFrame(notifyServer);');
    expect((viewer.match(/announceRouletteSettled\(\{/g) || []).length).toBe(2);
  });
});
