import test from 'node:test';
import assert from 'node:assert/strict';
import { extractChatEmotes } from '../server/emote-extractor.js';
import { safeEmoteImageUrl, normalizeEmoteSettings } from '../shared/emote-overlay.js';

const heart = 'https://ssl.pstatic.net/emotes/heart.webp';
const wave = 'https://cdn.ci.me/emotes/wave.gif';
const chat = raw => ({ type: 'chat', ts: 1700000000000, raw });

test('CHZZK preserves used token order and repetition without profile or unused images', () => {
  const result = extractChatEmotes('chzzk', chat({
    channelId: 'streamer', senderChannelId: 'viewer', messageId: 'message',
    content: '{:wave:} {:heart:}{:wave:}', emojis: { heart, wave, unused: heart },
    profile: { nickname: 'private-name', imageUrl: 'https://example.com/avatar.png', badges: [heart] },
  }));
  assert.deepEqual(result.items, [wave, heart, wave].map((url, i) => ({ url, name: i === 1 ? 'heart' : 'wave', provider: 'chzzk' })));
  assert.match(result.key, /^[a-f0-9]{64}$/);
  assert.match(result.actor, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(result).sort(), ['actor', 'items', 'key']);
  assert.doesNotMatch(JSON.stringify(result), /private-name|streamer|viewer|avatar|profile|content/);
});

test('CHZZK accepts mixed token forms without overlapping or substring duplicates', () => {
  const result = extractChatEmotes('chzzk', chat({
    content: '{:heart:} :heart: heart sweetheart {:heart-big:}',
    emojis: { heart, ':heart:': heart, 'heart-big': wave },
  }));
  assert.deepEqual(result.items.map(item => item.url), [heart, heart, heart, wave]);
});

test('legacy CHZZK extras JSON works and invalid extras fail closed', () => {
  assert.equal(extractChatEmotes('chzzk', chat({ content: '{:heart:}', extras: JSON.stringify({ emojis: { heart } }) })).items.length, 1);
  for (const extras of ['{bad', 'x'.repeat(100001), null, []]) {
    assert.equal(extractChatEmotes('chzzk', chat({ content: '{:heart:}', extras })), null);
  }
});

test('CIME uses exact content tokens and ignores plain text and badge URLs', () => {
  const event = chat({
    senderChannelId: 'cime-viewer', messageTime: '2026-10-12T00:00:00Z',
    content: 'hello :AaBbCc-wave: :AaBbCc-heart: :AaBbCc-wave:',
    emojis: { ':AaBbCc-heart:': heart, ':AaBbCc-wave:': wave, ':unused:': heart },
    profile: { badges: [{ url: 'https://example.com/badge.png' }] },
  });
  assert.deepEqual(extractChatEmotes('cime', event).items.map(item => item.url), [wave, heart, wave]);
  assert.equal(extractChatEmotes('cime', chat({ ...event.raw, content: 'ordinary text' })), null);
});

test('YouTube reads receiver message images only and preserves animated/custom emotes', () => {
  const result = extractChatEmotes('youtube', chat({
    id: 'yt-message', authorDetails: { channelId: 'yt-viewer', profileImageUrl: heart },
    receiverRaw: {
      author: { thumbnail: { url: heart }, badge: { thumbnail: { url: heart } } },
      message: [
        { text: 'hello' }, { url: wave, alt: ':wave:', emojiText: ':wave:', isCustomEmoji: true },
        { url: heart, alt: '', emojiText: '\u2764', isCustomEmoji: false },
        { text: 'image-like text', url: heart, alt: 'not an emoji' },
        { thumbnail: { url: wave }, alt: ':wave:' },
      ],
    },
  }));
  assert.deepEqual(result.items.map(item => item.url), [wave, heart, wave]);
  assert.deepEqual(result.items.map(item => item.name), [':wave:', '\u2764', ':wave:']);
  assert.doesNotMatch(JSON.stringify(result), /yt-viewer|thumbnail|author|hello/);
  assert.equal(extractChatEmotes('youtube', chat({ author: { thumbnail: { url: heart } }, message: [{ text: 'hello' }] })), null);
});

test('dedupe is stable per message/channel/provider and cooldown actor is stable per viewer', () => {
  const raw = { channelId: 'one', messageId: 'same', senderChannelId: 'viewer', content: ':heart:', emojis: { ':heart:': heart } };
  const first = extractChatEmotes('cime', chat(raw));
  assert.equal(extractChatEmotes('cime', chat(raw)).key, first.key);
  assert.notEqual(extractChatEmotes('cime', chat({ ...raw, channelId: 'two' })).key, first.key);
  assert.notEqual(extractChatEmotes('chzzk', chat(raw)).key, first.key);
  const second = extractChatEmotes('cime', chat({ ...raw, messageId: 'next' }));
  assert.notEqual(second.key, first.key);
  assert.equal(second.actor, first.actor);
  const yt = id => extractChatEmotes('youtube', chat({ receiverRaw: { id, author: { channelId: 'author' }, message: [{ url: heart, emojiText: ':heart:' }] } }));
  assert.equal(yt('a').actor, yt('b').actor);
  assert.notEqual(yt('a').key, yt('b').key);
});

test('all providers reject unsafe image schemes and private endpoints without fetching', () => {
  const invalid = ['http://example.com/a.png', 'data:image/png;base64,eA==', 'javascript:alert(1)', '/avatar.png',
    'https://localhost/a', 'https://foo.local/a', 'https://foo.internal/a', 'https://127.0.0.1/a',
    'https://2130706433/a', 'https://[::1]/a', 'https://user:pass@example.com/a', 'https://example.com:444/a',
    `https://example.com/${'a'.repeat(2048)}`, null, {}];
  for (const url of invalid) {
    assert.equal(safeEmoteImageUrl(url), null, String(url));
    assert.equal(extractChatEmotes('youtube', chat({ message: [{ url, emojiText: ':bad:' }] })), null);
    assert.equal(extractChatEmotes('cime', chat({ content: ':bad:', emojis: { ':bad:': url } })), null);
  }
  assert.equal(safeEmoteImageUrl(wave), wave);
});

test('extraction stays bounded and ignores non-chat or unsupported providers', () => {
  assert.equal(extractChatEmotes('unsupported', chat({})), null);
  assert.equal(extractChatEmotes('cime', { type: 'donation', raw: { content: ':heart:', emojis: { ':heart:': heart } } }), null);
  assert.equal(extractChatEmotes('cime', chat({ content: ':heart:'.repeat(500), emojis: { ':heart:': heart } })).items.length, 16);
  const parts = Array.from({ length: 500 }, () => ({ url: wave, emojiText: 'a'.repeat(300) }));
  const result = extractChatEmotes('youtube', chat({ message: parts }));
  assert.equal(result.items.length, 16);
  assert.ok(result.items.every(item => item.name.length === 80));
});

test('shared normalization supplies independent defaults and rejects invalid strict settings', () => {
  const first = normalizeEmoteSettings(), second = normalizeEmoteSettings();
  first.providers.chzzk = false;
  assert.equal(second.providers.chzzk, true);
  assert.equal(second.enabled, false);
  for (const value of [null, [], { size: Infinity }, { maxActive: 5.5 }, { enabled: 'true' }, { mode: 'unknown' }, { rain: { restitutionMin: .9, restitutionMax: .2 } }]) {
    assert.throws(() => normalizeEmoteSettings(value, { strict: true }), { status: 400 });
  }
  assert.deepEqual(normalizeEmoteSettings({ area: { x: 95, y: 95, width: 100, height: 100 } }).area, { x: 95, y: 95, width: 5, height: 5 });
});
