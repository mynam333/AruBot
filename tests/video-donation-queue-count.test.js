const path = require('path');
const { execFileSync } = require('child_process');

describe('video donation receipt queue count', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/video-donation-queue.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const queue = await import(${JSON.stringify(moduleUrl)});
      const current = { id: 'job-current', runtimeJobId: 'job-current' };
      console.log(JSON.stringify({
        includedOnce: queue.countVideoDonationQueueIncludingItem([
          { id: 'job-first', runtimeJobId: 'job-first' },
          current,
        ], current, 'processing'),
        workerBusyFallback: queue.countVideoDonationQueueIncludingItem([
          { id: 'job-first', runtimeJobId: 'job-first' },
        ], current, 'queued'),
        completedDuplicate: queue.countVideoDonationQueueIncludingItem([
          { id: 'job-first', runtimeJobId: 'job-first' },
        ], current, 'completed'),
        nonDurableItems: queue.countNonDurableVideoDonationItems([
          { id: 'job-first', runtimeJobId: 'job-first' },
          { id: 'admin-replay' },
        ]),
        defaultReceipt: queue.appendVideoDonationQueueCount('요청을 접수했습니다.', 1),
        customReceipt: queue.appendVideoDonationQueueCount('안내 요청을 접수했습니다. 영상 제목', 12),
      }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());
  });

  test('counts the accepted item exactly once even while the worker is busy', () => {
    expect(result.includedOnce).toBe(2);
    expect(result.workerBusyFallback).toBe(2);
    expect(result.completedDuplicate).toBe(1);
  });

  test('keeps non-durable admin replays in the operational queue total', () => {
    expect(result.nonDurableItems).toBe(1);
  });

  test('always places the requested total-count format at the end', () => {
    expect(result.defaultReceipt).toBe('요청을 접수했습니다. (총 1개)');
    expect(result.customReceipt).toBe('안내 요청을 접수했습니다. 영상 제목 (총 12개)');
  });
});
