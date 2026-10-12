import { createHash } from 'node:crypto';
import { safeEmoteImageUrl } from '../shared/emote-overlay.js';

export function extractChatEmotes(provider, event) {
  if (!['chzzk', 'cime', 'youtube'].includes(provider) || event?.type !== 'chat') return null;
  const raw = event.raw || event;
  const items = [];
  const add = (url, name, count = 1) => {
    const safe = safeEmoteImageUrl(url);
    if (!safe) return;
    for (let i = 0; i < Math.min(count, 16) && items.length < 16; i++) items.push({ url: safe, name: String(name || '이모티콘').slice(0, 80), provider });
  };
  if (provider === 'youtube') {
    const message = raw.receiverRaw?.message || raw.message;
    if (Array.isArray(message)) for (const part of message.slice(0, 200)) {
      if (typeof part?.text === 'string' || (typeof part?.emojiText !== 'string' && typeof part?.alt !== 'string')) continue;
      add(part.url || part.thumbnail?.url, part.emojiText || part.alt);
    }
  } else {
    let extras = raw.extras;
    if (typeof extras === 'string' && extras.length < 100_000) { try { extras = JSON.parse(extras); } catch { extras = null; } }
    const map = raw.emojis || extras?.emojis;
    const content = String(raw.content || event.message || '').slice(0, 10000);
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      const matches = [];
      for (const [key, url] of Object.entries(map).slice(0, 100)) {
        if (!key || key.length > 200) continue;
        const tokens = new Set(provider === 'chzzk' ? [key, `{:${key}:}`, `:${key}:`] : [key]);
        for (const token of tokens) {
          let offset = 0;
          for (let n = 0; n < 16; n++) {
            const index = content.indexOf(token, offset);
            if (index < 0) break;
            offset = index + token.length;
            if (/^[\w-]+$/.test(token) && (/[\w-]/.test(content[index - 1] || '') || /[\w-]/.test(content[offset] || ''))) continue;
            matches.push({ index, end: offset, url, name: key });
          }
        }
      }
      let end = -1;
      for (const match of matches.sort((a, b) => a.index - b.index || b.end - a.end)) {
        if (match.index < end) continue;
        end = match.end;
        add(match.url, match.name);
        if (items.length >= 16) break;
      }
    }
  }
  if (!items.length) return null;
  const timestamp = raw.messageTime || raw.timestamp || event.ts || '';
  const user = raw.senderChannelId || raw.profile?.userId || raw.authorDetails?.channelId || raw.receiverRaw?.author?.channelId || raw.author?.channelId || event.userId || event.id || '';
  const channel = raw.channelId || raw.snippet?.liveChatId || event.channelId || '';
  const messageId = raw.messageId || raw.id || raw.receiverRaw?.id || `${user}:${timestamp}:${event.message || raw.content || ''}`;
  return {
    key: createHash('sha256').update(`${provider}:${channel}:${messageId}`).digest('hex'),
    actor: createHash('sha256').update(`${provider}:${user}`).digest('hex'),
    items,
  };
}
