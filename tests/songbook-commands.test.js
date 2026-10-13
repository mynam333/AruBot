const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
function load(file, names, extra = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;$/gm, '').replace(/^export /gm, '');
  const context = { ...extra, module: { exports: {} } };
  vm.runInNewContext(`${source}\nmodule.exports={${names.join(',')}};`, context);
  return context.module.exports;
}
const shared = load('shared/songbook-commands.js', ['songbookCommandKinds', 'hasSongbookCommandToken', 'replaceSongbookCommandTokens', 'songbookCommandTemplate', 'matchSongbookSongs', 'commandEditVersion', 'songbookTriggerConflict']);
const { createSongbookCommandExecutor } = load('server/songbook-command-runtime.js', ['createSongbookCommandExecutor'], { ...shared, ...crypto });
const { assertBotManagerEffects } = load('shared/bot-management-policy.js', ['assertBotManagerEffects']);

test('templates are ordinary editable bot rules, identified by response tokens', () => {
  expect(shared.songbookCommandTemplate('request', 'id')).toMatchObject({ id: 'id', keywords: ['!노래신청'], responses: ['${songbook_request}'], pointsCost: 0 });
  expect(shared.songbookCommandKinds({ responses: ['link ${ SONGBOOK_URL }', '${songbook_request}'] })).toEqual(['url', 'request']);
  expect(shared.songbookCommandKinds({ responses: ['ordinary response'] })).toEqual([]);
});
test('edit conflict version ignores changing runtime cooldown timestamps', () => {
  expect(shared.commandEditVersion({ id: '1', lastUsed: 1, enabled: true })).toBe(shared.commandEditVersion({ enabled: true, lastUsed: 200, id: '1' }));
  expect(shared.commandEditVersion({ id: '1', enabled: true })).not.toBe(shared.commandEditVersion({ id: '1', enabled: false }));
});
test('conflicts detected from either page, including alternate triggers and casing', () => {
  const rule = { ...shared.songbookCommandTemplate('request', '1'), keywords: ['!노래신청', '!SR'] };
  const other = { id: '2', keywords: ['!sr'], responses: ['hello'] };
  expect(shared.songbookTriggerConflict(rule, [rule, other])).toBe(other);
  expect(shared.songbookTriggerConflict(other, [rule])).toBe(rule);
  expect(shared.songbookTriggerConflict(rule, [rule])).toBeNull();
});
test('search preserves exact title priority, title/artist disambiguation and hidden songs', () => {
  const songs = [{ id: '1', title: '밤편지', artist: '아이유' }, { id: '2', title: '밤편지 커버', artist: '다른 가수' }, { id: '3', title: '밤편지', artist: '비공개', visible: false }];
  expect(shared.matchSongbookSongs(songs, '밤편지').map(x => x.id)).toEqual(['1']);
  expect(shared.matchSongbookSongs(songs, '다른 가수 - 밤편지 커버').map(x => x.id)).toEqual(['2']);
  expect(shared.matchSongbookSongs(songs, '아이유 밤편지').map(x => x.id)).toEqual(['1']);
  expect(shared.matchSongbookSongs(songs, '2').map(x => x.id)).toEqual(['2']);
  expect(shared.matchSongbookSongs(songs, '없는 곡')).toEqual([]);
});
function harness() {
  const store = { requestSongFromChat: jest.fn(async () => ({ song: { title: '밤편지', artist: '아이유' }, username: '시청자' })) };
  const getPublicUrl = jest.fn(async () => 'https://example.test/c/channel/songbook');
  const logger = { error: jest.fn() };
  const execute = createSongbookCommandExecutor({ store, getPublicUrl, logger });
  return { execute, store, getPublicUrl, logger };
}
const context = { owner: 'owner', provider: 'chzzk', userId: 'viewer', username: '시청자', argsText: '밤편지', eventId: 'event1', keyword: '!신청' };
test.each(['chzzk', 'cime', 'youtube'])('%s command enqueues once for repeated tokens, keeping event idempotency', async provider => {
  const h = harness();
  expect(await h.execute('${songbook_request} / ${songbook_request}', { ...context, provider })).toContain('밤편지');
  expect(h.store.requestSongFromChat).toHaveBeenCalledTimes(1);
  const args = h.store.requestSongFromChat.mock.calls[0];
  expect(args.slice(0, 3)).toEqual(['owner', { provider, userId: 'viewer', username: '시청자' }, '밤편지']);
  await h.execute('${songbook_request}', { ...context, provider });
  expect(h.store.requestSongFromChat.mock.calls[1][3]).toBe(args[3]);
});
test('missing arguments shows concrete command and link without creating a request', async () => {
  const h = harness();
  expect(await h.execute('${songbook_request}', { ...context, argsText: '' })).toContain('!신청 곡명');
  expect(h.store.requestSongFromChat).not.toHaveBeenCalled();
});
test('link response never enqueues and replacement does not interpret dollar sequences', async () => {
  const h = harness();
  expect(await h.execute('노래책: ${songbook_url}', context)).toBe('노래책: https://example.test/c/channel/songbook');
  expect(h.store.requestSongFromChat).not.toHaveBeenCalled();
  expect(shared.replaceSongbookCommandTokens('${songbook_request}', { request: '$&' })).toBe('$&');
});
test('blocked execution strips tokens and never touches database', async () => {
  const h = harness();
  await h.execute('${songbook_request} ${songbook_url}', { ...context, allowed: false });
  expect(h.store.requestSongFromChat).not.toHaveBeenCalled();
  expect(h.getPublicUrl).not.toHaveBeenCalled();
});
test('a request token injected by a viewer cannot turn a link-only rule into an action', async () => {
  const h = harness();
  await h.execute('${songbook_request} ${songbook_url}', { ...context, template: '${songbook_url}' });
  expect(h.store.requestSongFromChat).not.toHaveBeenCalled();
});
test('business failures are actionable and database failures stay private', async () => {
  const h = harness();
  h.store.requestSongFromChat.mockRejectedValueOnce(Object.assign(new Error('지금은 노래 신청을 받지 않습니다.'), { status: 409 }));
  expect(await h.execute('${songbook_request}', context)).toBe('지금은 노래 신청을 받지 않습니다.');
  h.store.requestSongFromChat.mockRejectedValueOnce(new Error('password=private SQL'));
  expect(await h.execute('${songbook_request}', context)).not.toContain('SQL');
  expect(h.logger.error).toHaveBeenCalledTimes(1);
});
test('binding request execution requires songbook write scope', () => {
  expect(() => assertBotManagerEffects({ responses: ['${songbook_request}'] }, { role: 'manager', scopes: ['commands:write'] })).toThrow();
  expect(() => assertBotManagerEffects({ responses: ['${songbook_request}'] }, { role: 'manager', scopes: ['commands:write', 'songbook:write'] })).not.toThrow();
});
test('all live command paths invoke songbook only after admission and reply deduplication', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'server/index.js'), 'utf8');
  for (const provider of ['chzzk', 'youtube', 'cime']) {
    expect(index).toMatch(new RegExp(`executeSongbookCommand\\([^;]+provider: '${provider}'[^;]+eventId: replyKey[^;]+allowed: allowExecute && hasSongbookCommandToken\\(response\\)`));
  }
  const page = fs.readFileSync(path.join(__dirname, '..', 'src/features/songbook/songbook-command-editor.tsx'), 'utf8');
  expect(page).toContain("const endpoint = '/api/bot/rules'");
  expect(page).toContain('expectedVersion: commandEditVersion(draft.original)');
  expect(page).toContain("window.addEventListener('focus', refresh)");
});
