const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const server = read('server/index.js');
const start = server.indexOf('const BOT_VARIABLE_PROVIDERS =');
const end = server.indexOf("app.get('/api/bot/variables'", start);
const catalog = new Function(`${server.slice(start, end)}; return BOT_VARIABLES;`)();
const visible = catalog.filter((item) => !item.contexts?.length || item.contexts.includes('donation'));

test('donation help exposes all supported special and donor tokens', () => {
  expect(visible.filter((item) => item.key.startsWith('${')).map((item) => item.key).sort()).toEqual([
    '${roulette::룰렛이름}', '${action::액션이름}', '${blueprint::액션이름}', '${automation::액션이름}',
    '${counter::user::변수명}', '${counter::global::변수명}', '${memo::메모이름}', '${songbook_url}',
    '${dday::2026-08-14}', '${username}', '${amount}', '${message}',
  ].sort());
  expect(new Set(catalog.map((item) => item.key)).size).toBe(catalog.length);
});

test('argument-dependent, paid, manager-only and blueprint-only tokens are not advertised as donation actions', () => {
  const keys = visible.map((item) => item.key);
  for (const key of ['${memo}', '${video_donation}', '${bgm_request}', '${songbook_request}', '${live.title_change}', '${live.game_change}', '{flow.변수이름}']) {
    expect(keys).not.toContain(key);
  }
});

test('creation and editing both provide donation-scoped insertion and searchable help prioritizes actions', () => {
  expect(read('src/features/admin/admin-action-dialogs.tsx')).toContain('<CommandVariableHelpButton scope="donation" onInsert=');
  expect(read('src/features/admin/donation-rules-page.tsx')).toContain('<CommandVariableHelpButton scope="donation" onInsert=');
  const help = read('src/features/admin/command-variable-help.tsx');
  expect(help).toContain("['특수 실행', '후원', '카운트', '메모']");
  expect(help).toContain('aria-label="변수 검색"');
  expect(help).toContain('onInsert(key)');
  expect(help).toContain('setRetry((value) => value + 1)');
  expect(help).not.toContain('open || loaded');
});
