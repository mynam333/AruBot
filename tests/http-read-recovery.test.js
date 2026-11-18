const loadSource = require('./helpers/load-source.cjs');
let previousFetch;
beforeEach(() => { previousFetch = global.fetch; jest.useFakeTimers(); });
afterEach(() => { global.fetch = previousFetch; jest.clearAllTimers(); jest.useRealTimers(); });
const load = () => loadSource('src/shared/api/http.ts', { '@/shared/lib/bot-management-context': { getBotManagementOwner: () => null } });
const abortedFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

test.each(['readJson', 'readJsonResult'])('%s releases a timed-out shared read so the next attempt can recover', async method => {
  const http = load();
  global.fetch = jest.fn(abortedFetch);
  const first = http[method]('/api/test');
  const duplicate = http[method]('/api/test');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(15001);
  const results = await Promise.all([first, duplicate]);
  if (method === 'readJson') expect(results).toEqual([null, null]);
  else for (const result of results) {
    expect(result).toMatchObject({ ok: false, status: 408, code: 'request_timeout' });
    expect(result.message).not.toMatch(/abort/i);
  }
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ recovered: true }) });
  const result = await http[method]('/api/test');
  expect(method === 'readJson' ? result : result.data).toEqual({ recovered: true });
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

test('timeouts cover response body reads as well as headers', async () => {
  const http = load();
  global.fetch = jest.fn(async (_url, { signal }) => ({ ok: true, status: 200, json: () => abortedFetch('', { signal }) }));
  const request = http.readJsonResult('/api/test');
  await Promise.resolve();
  jest.advanceTimersByTime(15001);
  expect(await request).toMatchObject({ ok: false, code: 'request_timeout' });
});

test('caller cancellation remains cancellation, not a visible failure or retry', async () => {
  const http = load();
  global.fetch = jest.fn(abortedFetch);
  const controller = new AbortController();
  const pending = http.readJsonResult('/api/test', { signal: controller.signal });
  const error = new DOMException('Page changed', 'AbortError');
  controller.abort(error);
  await expect(pending).rejects.toBe(error);
  expect(jest.getTimerCount()).toBe(0);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each([new DOMException('signal is aborted without reason', 'AbortError'), new TypeError('Failed to fetch')])('unexpected browser interruption returns an understandable retryable error: %s', async error => {
  const http = load();
  global.fetch = jest.fn(async () => { throw error; });
  const result = await http.readJsonResult('/api/test');
  expect(result).toMatchObject({ ok: false, status: null, message: '서버 연결이 잠시 끊겼습니다. 잠시 후 다시 시도해 주세요.' });
  expect(jest.getTimerCount()).toBe(0);
});

test('long-running mutations are neither aborted nor automatically retried', async () => {
  const http = load();
  let resolve;
  global.fetch = jest.fn(() => new Promise(done => { resolve = done; }));
  const pending = http.readJsonResult('/api/action', { method: 'POST', body: '{}' });
  jest.advanceTimersByTime(60000);
  expect(jest.getTimerCount()).toBe(0);
  expect(global.fetch.mock.calls[0][1].signal).toBeUndefined();
  resolve({ ok: true, status: 200, json: async () => ({ saved: true }) });
  expect(await pending).toMatchObject({ ok: true });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
