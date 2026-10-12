const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const { toYoutubeLiveChatItem } = require('../server/youtube-live-chat-receiver.cjs');

test('the shared provider queue delivers cosmetic effects without blocking commands on failure', () => {
  const ingestEvent = jest.fn(() => { throw new Error('overlay unavailable'); });
  const { pushEvent } = loadServerFunctions(['pushEvent'], { MAX_QUEUE: 2, emoteOverlayRuntime: { ingestEvent } });
  const entry = { primarySid: 'user:owner', queue: [{ id: 'old' }] };
  const event = { type: 'chat', message: 'hello', raw: { emojis: {} } };
  expect(pushEvent(entry, event)).toBe(true);
  expect(ingestEvent).toHaveBeenCalledWith(entry, event);
  expect(entry.queue.at(-1)).toBe(event);
  expect(pushEvent(entry, { type: 'chat', message: 'next' })).toBe(true);
  expect(entry.queue).toHaveLength(2);
});

test('unsafe chat cannot reach the overlay hook', () => {
  const ingestEvent = jest.fn();
  const { pushEvent } = loadServerFunctions(['pushEvent'], { MAX_QUEUE: 2, emoteOverlayRuntime: { ingestEvent } });
  expect(pushEvent({ queue: [] }, { type: 'chat', message: `a${'\u0301'.repeat(30)}` })).toBe(false);
  expect(ingestEvent).not.toHaveBeenCalled();
});

test('YouTube receiver keeps original emote runs through existing normalization', () => {
  const { normalizeYoutubeChatEvent } = loadServerFunctions(['normalizeYoutubeChatEvent']);
  const image = { url: 'https://yt3.ggpht.com/emote=s48', alt: ':heart:', emojiText: ':heart:', isCustomEmoji: true };
  const raw = { id: 'message', author: { channelId: 'viewer', name: 'Viewer' }, timestamp: new Date(), message: [{ text: 'hi ' }, image] };
  const item = toYoutubeLiveChatItem(raw);
  const event = normalizeYoutubeChatEvent(item);
  expect(event.provider).toBe('youtube');
  expect(event.type).toBe('chat');
  expect(event.raw.receiverRaw.message[1]).toEqual(image);
});
