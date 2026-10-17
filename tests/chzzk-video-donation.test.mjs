import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import WebSocket, { WebSocketServer } from 'ws';
import {
  normalizeChzzkVideoDonationSettings,
  publicChzzkVideoDonationSettings,
  extractChzzkVideoDonation,
  createChzzkVideoDonationConnector,
} from '../server/chzzk-video-donation.js';

const OVERLAY = 'https://chzzk.naver.com/video-donation/video@private-key';
const API = 'https://api.chzzk.naver.com/manage/v1';
const SESSION = 'https://ssio09.nchat.naver.com:443?auth=session-secret';
const flat = {
  videoDonationChzzkPauseEnabled: true,
  videoDonationChzzkQueueEnabled: false,
  videoDonationChzzkOverlaySecret: OVERLAY,
};
const fixture = (extra = {}) => ({
  donationId: 'donation-1', videoId: 'o6OWF-IMFVs', videoType: 'YOUTUBE',
  profile: JSON.stringify({ nickname: 'Donor', userIdHash: 'user-hash' }),
  payAmount: 3000, donationText: 'Video title', startSecond: 5, endSecond: 35,
  titleExpose: true, isAnonymous: false, playMode: 'AUTO_PLAY', tierNo: 2,
  videoDescription: 'Separate donor commentary', ...extra,
});
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
};
const json = content => Response.json({ code: 200, content });

function harness(t, options = {}) {
  const calls = [];
  const sockets = [];
  const statuses = [];
  const donations = [];
  const controls = [];
  const settings = [];
  class FakeWebSocket extends EventEmitter {
    constructor(url, config) {
      super();
      this.url = url;
      this.config = config;
      this.sent = [];
      this.terminated = false;
      sockets.push(this);
    }
    send(packet) { this.sent.push(packet); }
    terminate() {
      this.terminated = true;
      this.emit('close');
    }
    message(packet, binary = false) { this.emit('message', Buffer.from(packet), binary); }
    event(name, payload) { this.message(`42${JSON.stringify([name, payload])}`); }
    handshake(interval = 25_000, timeout = 5000) {
      this.message(`0${JSON.stringify({ sid: 'engine-session', upgrades: [], pingInterval: interval, pingTimeout: timeout })}`);
      this.message('40');
    }
  }
  const fetchImpl = async (url, config) => {
    calls.push({ url, ...config });
    if (options.fetch) return options.fetch(url, config, calls);
    if (url.endsWith('/session-url')) return json({ sessionUrl: SESSION });
    if (url.endsWith('/alert-setting')) return json({ alertPauseActive: true, videoVolume: 75 });
    return json({});
  };
  const connector = createChzzkVideoDonationConnector({
    overlayUrl: OVERLAY, fetchImpl, WebSocketImpl: FakeWebSocket,
    onStatus: (status, error) => statuses.push({ status, error }),
    onDonation: value => donations.push(value),
    onControl: value => controls.push(value),
    onSettings: value => settings.push(value),
    ...options.connector,
  });
  t.after(() => connector.close());
  return { connector, calls, sockets, statuses, donations, controls, settings };
}

test('settings default to disabled with no URL and preserve omitted persisted keys', () => {
  assert.deepEqual(normalizeChzzkVideoDonationSettings(), { pauseEnabled: false, queueEnabled: false, overlayUrl: '' });
  assert.deepEqual(normalizeChzzkVideoDonationSettings(flat, undefined), { pauseEnabled: true, queueEnabled: false, overlayUrl: OVERLAY });
  assert.deepEqual(normalizeChzzkVideoDonationSettings(flat, { videoDonationChzzkQueueEnabled: true }), {
    pauseEnabled: true, queueEnabled: true, overlayUrl: OVERLAY,
  });
  assert.equal(normalizeChzzkVideoDonationSettings(flat, { videoDonationChzzkOverlaySecret: undefined }).overlayUrl, OVERLAY);
  assert.equal(normalizeChzzkVideoDonationSettings(flat, { videoDonationChzzkOverlaySecret: '' }).overlayUrl, '');
  assert.equal(normalizeChzzkVideoDonationSettings(flat, { overlayUrl: `${OVERLAY}?width=640&auth=ignored` }).overlayUrl, OVERLAY);
  assert.deepEqual(flat, {
    videoDonationChzzkPauseEnabled: true, videoDonationChzzkQueueEnabled: false, videoDonationChzzkOverlaySecret: OVERLAY,
  });
});

for (const overlayUrl of [
  'http://chzzk.naver.com/video-donation/video@secret',
  'https://chzzk.naver.com.evil.test/video-donation/video@secret',
  'https://evil.test@chzzk.naver.com/video-donation/video@secret',
  'https://chzzk.naver.com:444/video-donation/video@secret',
  'https://chzzk.naver.com/video-donation/video@',
  `${OVERLAY}/extra`, `${OVERLAY}#fragment`, `${OVERLAY}\n`, ` ${OVERLAY}`,
  'https://chzzk.naver.com/x/../video-donation/video@secret',
  'https://chzzk.naver.com/video-donation/video@%2e%2e',
  'https://chzzk.naver.com\\video-donation\\video@secret',
  'https://chzzk.naver.com/video-donation/video@secret?x=bad\\path',
  null, 5, {},
]) {
  test(`rejects invalid private overlay URL ${JSON.stringify(overlayUrl)}`, () => {
    assert.throws(() => normalizeChzzkVideoDonationSettings(flat, { overlayUrl }), error => {
      assert.equal(error.status, 400);
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /[\uac00-\ud7a3]/);
      assert.ok(!error.message.includes('secret'));
      return true;
    });
  });
}

test('public config never exposes a URL or the persisted secret', () => {
  assert.deepEqual(publicChzzkVideoDonationSettings(flat), { pauseEnabled: true, queueEnabled: false, configured: true });
  assert.deepEqual(publicChzzkVideoDonationSettings(), { pauseEnabled: false, queueEnabled: false, configured: false });
  assert.throws(() => normalizeChzzkVideoDonationSettings(flat, { pauseEnabled: 'false' }), { status: 400 });
});

test('normalizes the real JSON donation protocol with exact runtime fields', () => {
  assert.deepEqual(extractChzzkVideoDonation(JSON.stringify(fixture())), {
    donationId: 'donation-1', provider: 'youtube', mediaId: 'o6OWF-IMFVs',
    url: 'https://www.youtube.com/watch?v=o6OWF-IMFVs', title: 'Video title',
    username: 'Donor', userId: 'user-hash', startSec: 5, durationSec: 30, endSec: 35,
    playMode: 'AUTO_PLAY', amount: 3000, delayMs: 3000,
  });
});

test('CHZZK clip VIDEO_PLAY starts without delay and supports decimal/string timing', () => {
  const result = extractChzzkVideoDonation(fixture({
    donationId: 123, videoType: 'CHZZK_CLIP', videoId: 'zn2c8wcIXB', playMode: 'VIDEO_PLAY',
    startSecond: '0.5', endSecond: '20.5', payAmount: '1500',
    profile: { nickname: 'Clip donor', userIdHash: 'clip-user' },
  }));
  assert.equal(result.donationId, '123');
  assert.equal(result.provider, 'chzzk_clip');
  assert.equal(result.url, 'https://chzzk.naver.com/clips/zn2c8wcIXB');
  assert.equal(result.durationSec, 20);
  assert.equal(result.delayMs, 0);
  assert.equal(result.amount, 1500);
});

test('hides anonymous identities and honors titleExpose instead of substituting commentary', () => {
  const result = extractChzzkVideoDonation(fixture({ isAnonymous: true, titleExpose: false }));
  assert.equal(result.username, '\uC775\uBA85\uC758 \uD6C4\uC6D0\uC790');
  assert.equal(result.userId, '');
  assert.equal(result.title, '');
  assert.ok(!JSON.stringify(result).includes('Donor'));
  for (const profile of [undefined, null, '{invalid', [], 3]) {
    assert.equal(extractChzzkVideoDonation(fixture({ profile })).userId, '');
  }
});

test('unknown duration stays null and long VOD offsets are allowed within six hours', () => {
  for (const endSecond of [null, undefined]) {
    const value = extractChzzkVideoDonation(fixture({ startSecond: 3601, endSecond }));
    assert.equal(value.durationSec, null);
    assert.equal(value.endSec, null);
    assert.equal(value.startSec, 3601);
  }
  const value = extractChzzkVideoDonation(fixture({ startSecond: 0, endSecond: 21600 }));
  assert.equal(value.durationSec, 21600);
  assert.equal(extractChzzkVideoDonation(fixture({ startSecond: undefined })).startSec, 0);
});

test('rejects invalid ranges, IDs, amounts, modes and types without coercing booleans', () => {
  for (const patch of [
    { playMode: 'ALERT_PLAY' }, { playMode: 'IGNORE' }, { playMode: undefined },
    { videoType: 'UNKNOWN' }, { videoId: 'bad' }, { videoId: '../secret', videoType: 'CHZZK_CLIP' },
    { donationId: '' }, { donationId: '../secret' }, { donationId: Number.MAX_SAFE_INTEGER + 1 },
    { startSecond: -1 }, { startSecond: true }, { startSecond: '' }, { startSecond: 'Infinity' },
    { endSecond: 4 }, { endSecond: 5 }, { endSecond: 21601 }, { endSecond: false },
    { startSecond: 21600, endSecond: null }, { startSecond: '0x10' },
    { payAmount: -1 }, { payAmount: true }, { payAmount: 'NaN' }, { payAmount: Infinity },
    { startSecond: NaN }, { endSecond: Infinity }, { endSecond: NaN },
    { payAmount: Number.MAX_SAFE_INTEGER + 1 }, { isAnonymous: 'false' }, { titleExpose: 1 },
  ]) assert.equal(extractChzzkVideoDonation(fixture(patch)), null, JSON.stringify(patch));
});

test('malformed, circular, array and oversized UTF-8 payloads fail closed', () => {
  const circular = {};
  circular.self = circular;
  for (const payload of [null, undefined, 'null', '[]', '{bad', [], 5, circular,
    fixture({ donationText: 'x'.repeat(65_536) }), fixture({ videoDescription: '\uD55C'.repeat(23_000) }),
  ]) assert.equal(extractChzzkVideoDonation(payload), null);
});

test('connects using fixed no-cookie APIs and restricted EIO3 transport', async t => {
  const h = harness(t);
  await flush();
  assert.deepEqual(h.calls.map(call => call.url), [
    `${API}/alerts/video@private-key/session-url`, `${API}/video-session/video@private-key/alert-setting`,
  ]);
  for (const call of h.calls) {
    assert.equal(call.credentials, 'omit');
    assert.equal(call.redirect, 'error');
    assert.deepEqual(call.headers, { Accept: 'application/json' });
  }
  assert.deepEqual(h.settings, [{ alertPauseActive: true, videoVolume: 75 }]);
  const socket = h.sockets[0];
  const url = new URL(socket.url);
  assert.equal(url.origin, 'wss://ssio09.nchat.naver.com');
  assert.equal(url.pathname, '/socket.io/');
  assert.equal(url.searchParams.get('EIO'), '3');
  assert.equal(url.searchParams.get('transport'), 'websocket');
  assert.equal(url.searchParams.get('auth'), 'session-secret');
  assert.equal(socket.config.maxPayload, 65_536);
  assert.equal(socket.config.perMessageDeflate, false);
  assert.equal(socket.config.followRedirects, false);
  socket.handshake();
  assert.deepEqual(h.statuses.map(value => value.status), ['connecting', 'connected']);
  assert.deepEqual(socket.sent, []); // The EIO3 server connects the default namespace.
});

test('dispatches normalized donations, raw VIDEO settings, and validated stop objects', async t => {
  const h = harness(t);
  await flush();
  const socket = h.sockets[0];
  socket.event('donation', fixture());
  assert.equal(h.donations.length, 0);
  socket.handshake();
  socket.event('donation', JSON.stringify(fixture()));
  socket.event('donation', fixture({ donationId: 'manual', playMode: 'VIDEO_PLAY' }));
  socket.event('donation', fixture({ playMode: 'ALERT_PLAY' }));
  socket.event('donation', '{malformed');
  socket.message('42{bad');
  socket.event('donationControl', JSON.stringify({ donationId: 'donation-1', stopVideo: true, extra: 'not needed' }));
  socket.event('donationControl', { donationId: 'donation-1', stopVideo: 'true' });
  socket.event('donationControl', { donationId: '../unsafe', stopVideo: true });
  socket.event('donationSetting', JSON.stringify({ donationType: 'VIDEO', alertPauseActive: false, videoVolume: 10 }));
  socket.event('donationSetting', { donationType: 'VIDEO', videoVolume: 20 });
  socket.event('donationSetting', { donationType: 'CHAT', alertPauseActive: false });
  socket.event('donationSetting', { donationType: 'VIDEO', alertPauseActive: 'false' });
  assert.equal(h.donations.length, 2);
  assert.equal(h.donations[0].delayMs, 3000);
  assert.equal(h.donations[1].delayMs, 0);
  assert.deepEqual(h.controls, [{ donationId: 'donation-1', stopVideo: true }]);
  assert.deepEqual(h.settings.slice(1), [
    { donationType: 'VIDEO', alertPauseActive: false, videoVolume: 10 },
    { donationType: 'VIDEO', videoVolume: 20 },
  ]);
  assert.equal(h.calls.filter(call => call.method === 'PUT').length, 0);
});

test('EIO3 client pings, accepts server pong, and refreshes session after missing pong', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t);
  await flush();
  const socket = h.sockets[0];
  socket.handshake(100, 50);
  t.mock.timers.tick(99);
  assert.deepEqual(socket.sent, []);
  t.mock.timers.tick(1);
  assert.deepEqual(socket.sent, ['2']);
  socket.message('3');
  t.mock.timers.tick(100);
  assert.deepEqual(socket.sent, ['2', '2']);
  t.mock.timers.tick(50);
  assert.equal(socket.terminated, true);
  assert.equal(h.statuses.at(-1).status, 'retrying');
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(h.sockets.length, 2);
  assert.equal(h.calls.filter(call => call.url.endsWith('/session-url')).length, 2);
});

test('unlimited retry backoff is capped at 30 seconds and never overlaps attempts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t, { fetch: async () => { throw new Error(`${OVERLAY} session-secret`); } });
  await flush();
  let count = 1;
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]) {
    assert.equal(h.calls.length, count);
    t.mock.timers.tick(delay - 1);
    await flush();
    assert.equal(h.calls.length, count);
    t.mock.timers.tick(1);
    await flush();
    count++;
  }
  assert.equal(h.calls.length, count);
  assert.ok(!JSON.stringify(h.statuses).includes('private-key'));
  assert.ok(!JSON.stringify(h.statuses).includes('session-secret'));
  h.connector.close();
  t.mock.timers.tick(120_000);
  await flush();
  assert.equal(h.calls.length, count);
});

test('error plus close schedules only one reconnect; retired sockets cannot deliver events', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t);
  await flush();
  const socket = h.sockets[0];
  socket.handshake();
  socket.emit('error', new Error(SESSION));
  socket.emit('close', 1006, Buffer.from(OVERLAY));
  socket.event('donation', fixture());
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(h.sockets.length, 2);
  assert.equal(h.donations.length, 0);
  assert.equal(h.statuses.filter(value => value.status === 'retrying').length, 1);
});

for (const sessionUrl of [
  'http://ssio09.nchat.naver.com', 'ws://ssio09.nchat.naver.com',
  'https://nchat.naver.com', 'https://ssio09.nchat.naver.com.evil.test',
  'https://127.0.0.1/socket.io', 'https://ssio09.nchat.naver.com:444',
  'https://secret@ssio09.nchat.naver.com', 'https://ssio09.nchat.naver.com/evil',
  'https://ssio09.nchat.naver.com/x/../socket.io', 'https://ssio09.nchat.naver.com/%73ocket.io',
  'https://ssio09.nchat.naver.com/socket.io#secret', 'https://ssio09.nchat.naver.com./',
]) {
  test(`session SSRF restrictions reject ${sessionUrl}`, async t => {
    const h = harness(t, { fetch: async () => json({ sessionUrl }) });
    await flush();
    assert.equal(h.sockets.length, 0);
    assert.equal(h.calls.length, 1);
    assert.equal(h.statuses.at(-1).status, 'retrying');
    assert.ok(!JSON.stringify(h.statuses).includes(sessionUrl));
  });
}

test('valid wss socket.io session path preserves auth but replaces stale engine parameters', async t => {
  const h = harness(t, { fetch: async url => url.endsWith('/session-url')
    ? json({ sessionUrl: 'wss://ssio09.nchat.naver.com/socket.io?auth=token&EIO=4&transport=polling&sid=stale' })
    : json({ alertPauseActive: false }) });
  await flush();
  const url = new URL(h.sockets[0].url);
  assert.equal(url.searchParams.get('EIO'), '3');
  assert.equal(url.searchParams.get('transport'), 'websocket');
  assert.equal(url.searchParams.get('auth'), 'token');
  assert.equal(url.searchParams.has('sid'), false);
});

test('HTTP redirects, wrong response origins, API failures and oversized bodies are rejected', async t => {
  const responses = [
    () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/secret' } }),
    () => Object.defineProperty(json({ sessionUrl: SESSION }), 'redirected', { value: true }),
    () => Object.defineProperty(json({ sessionUrl: SESSION }), 'url', { value: 'https://evil.test/' }),
    () => Response.json({ code: 401, content: { sessionUrl: SESSION } }),
    () => new Response('x'.repeat(65_537)),
    () => new Response('{}', { headers: { 'content-length': '65537' } }),
  ];
  for (const response of responses) {
    const h = harness(t, { fetch: async () => response() });
    await flush();
    assert.equal(h.sockets.length, 0);
    assert.equal(h.statuses.at(-1).status, 'retrying');
    h.connector.close();
  }
});

test('initial settings failure retries before allowing any donations', async t => {
  const h = harness(t, { fetch: async url => url.endsWith('/session-url')
    ? json({ sessionUrl: SESSION }) : json({ alertPauseActive: 'true' }) });
  await flush();
  assert.equal(h.sockets.length, 0);
  assert.equal(h.settings.length, 0);
  assert.equal(h.statuses.at(-1).status, 'retrying');
});

test('oversized, binary and invalid handshake packets terminate the connection', async t => {
  for (const packet of [
    'x'.repeat(65_537), '0{}', '0{"sid":"x","pingInterval":-1,"pingTimeout":100}',
    '0{"sid":"x","pingInterval":100,"pingTimeout":999999999}', '450-["event"]',
  ]) {
    const h = harness(t);
    await flush();
    h.sockets[0].message(packet);
    assert.equal(h.sockets[0].terminated, true, packet.slice(0, 100));
    h.connector.close();
  }
  const h = harness(t);
  await flush();
  h.sockets[0].message('42[]', true);
  assert.equal(h.sockets[0].terminated, true);
});

test('application handshake and fetch timeouts recover without overlap', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t);
  await flush();
  t.mock.timers.tick(10_000);
  assert.equal(h.sockets[0].terminated, true);
  h.connector.close();
  const hanging = harness(t, { fetch: () => new Promise(() => {}) });
  await flush();
  assert.equal(hanging.calls.length, 1);
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(hanging.calls[0].signal.aborted, true);
  assert.equal(hanging.statuses.at(-1).status, 'retrying');
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(hanging.calls.length, 2);
});

test('close aborts pending fetch and ignores its late response', async t => {
  let resolve;
  const h = harness(t, { fetch: () => new Promise(done => { resolve = done; }) });
  await flush();
  h.connector.close();
  h.connector.close();
  assert.equal(h.calls[0].signal.aborted, true);
  resolve(json({ sessionUrl: SESSION }));
  await flush();
  assert.equal(h.sockets.length, 0);
  assert.equal(h.statuses.filter(value => value.status === 'disabled').length, 1);
  assert.equal(h.statuses.at(-1).status, 'disabled');
});

test('close during initial settings callback prevents socket creation', async t => {
  const h = harness(t, { connector: { onSettings: () => h.connector.close() } });
  await flush();
  assert.equal(h.sockets.length, 0);
  assert.equal(h.statuses.at(-1).status, 'disabled');
});

test('disabled connector performs no network requests', async t => {
  const h = harness(t, { connector: { overlayUrl: '' } });
  await flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.sockets.length, 0);
  assert.equal(h.statuses[0].status, 'disabled');
  assert.equal(await h.connector.notifyPlayback('donation-1', 'play'), false);
});

test('callback failures are contained and never expose upstream secrets', async t => {
  const h = harness(t, { connector: {
    onDonation: async () => { throw new Error(OVERLAY); },
    onControl: () => { throw new Error(SESSION); },
  } });
  await flush();
  h.sockets[0].handshake();
  h.sockets[0].event('donation', fixture());
  h.sockets[0].event('donationControl', { donationId: 'donation-1', stopVideo: true });
  await flush();
  assert.equal(h.statuses.filter(value => value.status === 'error').length, 2);
  assert.ok(!JSON.stringify(h.statuses).includes('private-key'));
  assert.ok(!JSON.stringify(h.statuses).includes('session-secret'));
  assert.equal(h.sockets[0].terminated, false);
});

test('notifyPlayback explicitly PUTs play/end, skips TEST and rejects path injection', async t => {
  const h = harness(t);
  await flush();
  assert.equal(await h.connector.notifyPlayback('donation-1', 'play'), true);
  assert.equal(await h.connector.notifyPlayback('donation-1', 'end'), true);
  assert.equal(await h.connector.notifyPlayback('TEST', 'play'), false);
  await assert.rejects(h.connector.notifyPlayback('../private', 'play'), { status: 400 });
  await assert.rejects(h.connector.notifyPlayback('donation-1', 'stop'), { status: 400 });
  const puts = h.calls.filter(call => call.method === 'PUT');
  assert.deepEqual(puts.map(call => call.url), [
    `${API}/video-session/video@private-key/donations/donation-1/play`,
    `${API}/video-session/video@private-key/donations/donation-1/end`,
  ]);
  h.connector.close();
  assert.equal(await h.connector.notifyPlayback('donation-1', 'play'), false);
});

test('studio PLAY/STOP controls are delivered without requiring the manual stopVideo flag', async t => {
  const h = harness(t);
  await flush();
  const socket = h.sockets[0];
  socket.handshake();
  socket.event('donationControl', JSON.stringify({ donationId: 123, donationCommand: 'PLAY' }));
  socket.event('donationControl', { donationId: 123, donationCommand: 'STOP', stopVideo: false });
  socket.event('donationControl', { donationId: '../unsafe', donationCommand: 'STOP' });
  socket.event('donationControl', { donationId: 123, donationCommand: 'PAUSE' });
  assert.deepEqual(h.controls, [
    { donationId: '123', donationCommand: 'PLAY' },
    { donationId: '123', donationCommand: 'STOP' },
  ]);
  assert.equal(h.calls.some(call => call.method === 'PUT'), false);
});

test('duplicate in-flight notifications share one request and close aborts it', async t => {
  const h = harness(t, { fetch: async (url, options) => {
    if (options.method === 'PUT') return new Promise(() => {});
    return url.endsWith('/session-url') ? json({ sessionUrl: SESSION }) : json({ alertPauseActive: false });
  } });
  await flush();
  const first = h.connector.notifyPlayback('donation-1', 'play');
  const second = h.connector.notifyPlayback('donation-1', 'play');
  assert.equal(first, second);
  const rejected = assert.rejects(first, { message: 'CHZZK playback notification failed.' });
  h.connector.close();
  await rejected;
  assert.equal(h.calls.filter(call => call.method === 'PUT').length, 1);
  assert.equal(h.calls.at(-1).signal.aborted, true);
});

test('notification API errors fail without exposing response bodies and 204 is accepted', async t => {
  const h = harness(t, { fetch: async (url, options) => {
    if (options.method === 'PUT') {
      return url.endsWith('/play')
        ? Response.json({ code: 403, message: OVERLAY })
        : new Response(null, { status: 204 });
    }
    return url.endsWith('/session-url') ? json({ sessionUrl: SESSION }) : json({ alertPauseActive: false });
  } });
  await flush();
  await assert.rejects(h.connector.notifyPlayback('donation-1', 'play'), { message: 'CHZZK playback notification failed.' });
  assert.equal(await h.connector.notifyPlayback('donation-1', 'end'), true);
  assert.ok(!JSON.stringify(h.statuses).includes('private-key'));
});

test('real ws transport handles EIO3 heartbeat and rejects fragmented payloads above 64 KiB', { timeout: 5000 }, async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  let connector;
  t.after(async () => {
    connector?.close();
    for (const client of server.clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
  });
  let peer;
  const pings = [];
  let gotPing;
  const pingReceived = new Promise(resolve => { gotPing = resolve; });
  let gotDonation;
  const donationReceived = new Promise(resolve => { gotDonation = resolve; });
  let gotRetry;
  const retryReceived = new Promise(resolve => { gotRetry = resolve; });
  server.on('connection', socket => {
    peer = socket;
    socket.on('error', () => {});
    socket.on('message', data => {
      pings.push(data.toString());
      if (data.toString() === '2') {
        socket.send('3');
        gotPing();
      }
    });
    socket.send('0{"sid":"local-engine","upgrades":[],"pingInterval":25,"pingTimeout":1000}');
    socket.send('40');
    socket.send(`42${JSON.stringify(['donation', JSON.stringify(fixture())])}`);
  });
  class LocalTransport extends WebSocket {
    constructor(_validatedUpstreamUrl, options) {
      super(`ws://127.0.0.1:${server.address().port}/socket.io/?EIO=3&transport=websocket`, options);
    }
  }
  connector = createChzzkVideoDonationConnector({
    overlayUrl: OVERLAY, WebSocketImpl: LocalTransport,
    fetchImpl: async url => url.endsWith('/session-url') ? json({ sessionUrl: SESSION }) : json({ alertPauseActive: false }),
    onDonation: gotDonation,
    onStatus: state => { if (state === 'retrying') gotRetry(); },
  });
  const donation = await donationReceived;
  assert.equal(donation.donationId, 'donation-1');
  await pingReceived;
  assert.deepEqual(pings, ['2']);
  peer.send('x'.repeat(40_000), { fin: false });
  peer.send('x'.repeat(40_000), { fin: true });
  await retryReceived;
});
