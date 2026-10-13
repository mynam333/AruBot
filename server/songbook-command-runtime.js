import { createHash, randomUUID } from 'node:crypto';
import { hasSongbookCommandToken, replaceSongbookCommandTokens } from '../shared/songbook-commands.js';

export function createSongbookCommandExecutor({ store, getPublicUrl, logger = console }) {
  return async function execute(text, { owner, provider, userId, username, argsText = '', eventId, keyword = '!노래신청', allowed = true, template = text }) {
    if (!hasSongbookCommandToken(text)) return text;
    if (!allowed) return replaceSongbookCommandTokens(text, {});
    const needsRequest = /\$\{\s*songbook_request\s*\}/i.test(template) && /\$\{\s*songbook_request\s*\}/i.test(text);
    let request = '';
    let url = '';
    try {
      if ((/\$\{\s*songbook_url\s*\}/i.test(template) && /\$\{\s*songbook_url\s*\}/i.test(text)) || (needsRequest && !argsText.trim())) {
        url = await getPublicUrl(owner, provider) || '노래책 링크를 확인할 수 없습니다.';
      }
      if (needsRequest) {
        if (!argsText.trim()) request = `신청 방법: ${keyword} 곡명 (동명이곡: ${keyword} 가수 곡명) · ${url}`;
        else {
          const hash = createHash('sha256').update(JSON.stringify([owner, provider, userId, eventId || randomUUID()])).digest('hex');
          const requestKey = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
          const item = await store.requestSongFromChat(owner, { provider, userId, username }, argsText.trim(), requestKey);
          request = `노래 신청 접수: ${item.song.title} · ${item.song.artist} (${item.username})`;
        }
      }
      return replaceSongbookCommandTokens(text, { request, url }).trim();
    } catch (error) {
      if (!error.status) logger.error('[songbook] Chat request failed:', error);
      return error.status ? error.message : '노래 신청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
  };
}
