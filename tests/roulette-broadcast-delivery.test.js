const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

describe('roulette broadcast delivery', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/roulette-broadcast-delivery.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const { createRouletteBroadcastDelivery } = await import(${JSON.stringify(moduleUrl)});

      const message = { type: 'roulette', spinId: 'spin-1', label: '당첨' };
      const popupResults = [
        { success: 0, failed: 0, total: 0, error: 'NO_CONNECTIONS' },
        { success: 0, failed: 1, total: 1, error: 'TEST_CONNECTION_UNAVAILABLE' },
        { success: 1, failed: 0, total: 1 },
        { success: 1, failed: 0, total: 1 },
      ];
      const popupMessages = [];
      const channelMessages = [];
      const mirrorOutcomes = [];
      const deliver = createRouletteBroadcastDelivery({
        mirrorTestToChannel: true,
        deliverToTest: async (payload) => {
          popupMessages.push(payload.message);
          return popupResults.shift();
        },
        deliverToChannel: async (payload) => {
          channelMessages.push(payload.message);
          return { success: 0, failed: 0, total: 0, error: 'NO_CONNECTIONS' };
        },
        onMirrorSettled: ({ result: mirrorResult, error }) => {
          mirrorOutcomes.push({ result: mirrorResult, error: error?.message || null });
        },
      });
      const payload = {
        targetConnectionId: 'roulette_test_connection_1',
        channelId: 'channel-1',
        token: 'rlt_test_token',
        message,
      };
      const retryResults = [
        await deliver(payload),
        await deliver(payload),
        await deliver(payload),
        await deliver(payload),
      ];

      let thrownMirrorCallback = null;
      const thrownMirrorPrimary = { success: 1, failed: 0, total: 1 };
      const deliverWithThrowingMirror = createRouletteBroadcastDelivery({
        mirrorTestToChannel: true,
        deliverToTest: async () => thrownMirrorPrimary,
        deliverToChannel: async () => { throw new Error('obs unavailable'); },
        onMirrorSettled: ({ error }) => { thrownMirrorCallback = error?.message || null; },
      });
      const throwingMirrorResult = await deliverWithThrowingMirror(payload);

      let regularTestCalls = 0;
      let regularChannelCalls = 0;
      const regularResult = { success: 2, failed: 0, total: 2 };
      const deliverRegular = createRouletteBroadcastDelivery({
        mirrorTestToChannel: true,
        deliverToTest: async () => { regularTestCalls += 1; },
        deliverToChannel: async (regularPayload) => {
          regularChannelCalls += 1;
          if (regularPayload.message !== message) throw new Error('message identity changed');
          return regularResult;
        },
      });
      const regularDeliveryResult = await deliverRegular({ channelId: 'channel-1', token: 'rlt_test_token', message });

      let disabledChannelCalls = 0;
      const deliverWithoutMirror = createRouletteBroadcastDelivery({
        mirrorTestToChannel: false,
        deliverToTest: async () => ({ success: 1, failed: 0, total: 1 }),
        deliverToChannel: async () => { disabledChannelCalls += 1; },
      });
      await deliverWithoutMirror(payload);
      await new Promise((resolve) => setImmediate(resolve));

      console.log(JSON.stringify({
        retryResults,
        popupCallCount: popupMessages.length,
        channelCallCount: channelMessages.length,
        sameMessageObject: popupMessages.every((item) => item === message) && channelMessages.every((item) => item === message),
        mirrorOutcomes,
        throwingMirrorReturnedPrimary: throwingMirrorResult === thrownMirrorPrimary,
        thrownMirrorCallback,
        regularTestCalls,
        regularChannelCalls,
        regularReturnedOriginal: regularDeliveryResult === regularResult,
        disabledChannelCalls,
      }));
    `;

    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
    }).trim());
  });

  test('mirrors the same successful popup event to OBS exactly once after retries', () => {
    expect(result.retryResults.map((entry) => entry.success)).toEqual([0, 0, 1, 1]);
    expect(result.popupCallCount).toBe(4);
    expect(result.channelCallCount).toBe(1);
    expect(result.sameMessageObject).toBe(true);
    expect(result.mirrorOutcomes).toEqual([{
      result: { success: 0, failed: 0, total: 0, error: 'NO_CONNECTIONS' },
      error: null,
    }]);
  });

  test('keeps popup success authoritative when the OBS mirror throws', () => {
    expect(result.throwingMirrorReturnedPrimary).toBe(true);
    expect(result.thrownMirrorCallback).toBe('obs unavailable');
  });

  test('preserves regular channel delivery and requires explicit mirroring', () => {
    expect(result.regularTestCalls).toBe(0);
    expect(result.regularChannelCalls).toBe(1);
    expect(result.regularReturnedOriginal).toBe(true);
    expect(result.disabledChannelCalls).toBe(0);
  });

  test('enables mirroring only for the authenticated administrator test without a live-state guard', () => {
    const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
    const deliveryModule = fs.readFileSync(path.join(__dirname, '..', 'server', 'roulette-broadcast-delivery.js'), 'utf8');
    const adminStart = serverIndex.indexOf("app.post('/api/roulette/test'");
    const adminEnd = serverIndex.indexOf('// Public: list roulette definitions', adminStart);
    const adminRoute = serverIndex.slice(adminStart, adminEnd);
    const localStart = serverIndex.indexOf("app.post('/api/local-remote/roulette/test'");
    const localEnd = serverIndex.indexOf("app.post('/api/local-remote/video-donation/pop'", localStart);
    const localRoute = serverIndex.slice(localStart, localEnd);

    expect(adminRoute).toContain('mirrorTestToChannel: true');
    expect(localRoute).not.toContain('mirrorTestToChannel');
    expect(adminRoute).not.toMatch(/isSidLive|isLiveAllowedForSid|getLiveCached|liveStatusCache/);
    expect(deliveryModule).not.toMatch(/isSidLive|isLiveAllowedForSid|getLiveCached|liveStatusCache/);
  });
});
