const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const featurePath = path.join(__dirname, '../src/features/admin/bot-managers-page.tsx');
let context;
const source = fs.readFileSync(featurePath, 'utf8');
const compiled = ts.transpileModule(`${source}\nexport { getScopeGroups, normalizeScopes, setScopePermission, uniqueMembers, uniqueSearchUsers, PermissionEditor, PermissionSummary };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const feature = { exports: {} };
vm.runInNewContext(compiled, {
  exports: feature.exports,
  module: feature,
  require(name) {
    if (name === '@/components/app-shell/bot-channel-provider') return { useBotChannel: () => context };
    if (name === '@/components/ui/button') return { Button: ({ variant: _variant, size: _size, ...props }) => React.createElement('button', props) };
    if (name === '@/components/ui/input') return { Input: 'input' };
    if (name === '@/components/ui/badge') return { Badge: ({ children }) => React.createElement('span', null, children) };
    if (name === '@/components/ui/tooltip') return { Tooltip: ({ children }) => children };
    if (name === '@/shared/api/http') return { readJsonResult: () => { throw new Error('Unexpected network call in UI unit test'); } };
    if (name === '@/shared/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') };
    return require(name);
  },
});
const ui = feature.exports;

describe('Bot manager UI permissions', () => {
  test('renders all operational modules with safe fallback labels', () => {
    const groups = ui.getScopeGroups(undefined);
    expect(groups.map((group) => group.key)).toEqual(['dashboard', 'connection', 'commands', 'macros', 'points', 'predictions', 'roulette', 'wheel', 'video', 'songbook', 'emotes', 'drawing', 'donations', 'automations', 'actions', 'logs', 'settings']);
    expect(ui.getScopeGroups(null)).toEqual(groups);
    expect(ui.getScopeGroups({})).toEqual(groups);
    const labeled = ui.getScopeGroups([null, { key: 'commands', label: '서버 명령어', description: '서버 설명' }, { key: 'points', label: ' ' }, { key: 'members', label: '관리자 변경' }]);
    expect(labeled.find((group) => group.key === 'commands')).toEqual({ key: 'commands', label: '서버 명령어', description: '서버 설명' });
    expect(labeled.find((group) => group.key === 'points').label).toBe('포인트');
    expect(labeled).toHaveLength(groups.length);
  });

  test('normalizes wildcard and missing scopes without granting unexpected access', () => {
    expect(ui.normalizeScopes(null)).toEqual([]);
    expect(ui.normalizeScopes(undefined)).toEqual([]);
    expect(ui.normalizeScopes(['*', 'commands:write'])).toEqual(['*']);
    expect(ui.normalizeScopes([null, '', 42])).toEqual([]);
  });

  test('write includes read and does not mutate the original scopes', () => {
    const original = ['commands:write', 'commands:write'];
    expect(ui.normalizeScopes(original)).toEqual(['commands:read', 'commands:write']);
    expect(original).toEqual(['commands:write', 'commands:write']);
    expect(ui.setScopePermission([], 'commands', 'write', true)).toEqual(['commands:read', 'commands:write']);
  });

  test('disabling read also disables write while disabling write retains read', () => {
    const scopes = ['commands:read', 'commands:write', 'points:read'];
    expect(ui.setScopePermission(scopes, 'commands', 'read', false)).toEqual(['points:read']);
    expect(ui.setScopePermission(scopes, 'commands', 'write', false)).toEqual(['commands:read', 'points:read']);
    expect(ui.setScopePermission([], 'commands', 'read', true)).toEqual(['commands:read']);
  });

  test('full access is labeled operational and excludes owner-only privileges', () => {
    const html = renderToStaticMarkup(React.createElement(ui.PermissionEditor, { scopes: ['*'], groups: ui.getScopeGroups(), disabled: false, onChange() {} }));
    expect(html).toContain('전체 운영 권한');
    expect(html).toContain('관리자 등록, 개인 인증 및 보안 연결 권한은 제외됩니다.');
    expect(html).not.toContain('<table');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
  });

  test('advanced matrix warns about local execution and permits read-only scopes', () => {
    const html = renderToStaticMarkup(React.createElement(ui.PermissionEditor, { scopes: ['commands:read'], groups: ui.getScopeGroups(), disabled: false, onChange() {} }));
    expect(html).toContain('고급 권한 설정');
    expect(html).toContain('자동화·액션 수정 권한은 연결된 PC');
    const matrix = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
    expect(matrix.match(/type="checkbox"/g)).toHaveLength(ui.getScopeGroups(undefined).length * 2);
    expect(matrix.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain('채팅 명령어 조회 허용');
    expect(html).toContain('채팅 명령어 수정 허용');
  });

  test('empty selection is explained and pending disables every scope control', () => {
    const html = renderToStaticMarkup(React.createElement(ui.PermissionEditor, { scopes: [], groups: ui.getScopeGroups(), disabled: true, onChange() {} }));
    expect(html).toContain('조회 또는 수정 권한을 하나 이상 선택해 주세요.');
    const matrix = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
    const inputs = matrix.match(/<input\b[^>]*>/g);
    expect(inputs).toHaveLength(ui.getScopeGroups(undefined).length * 2);
    expect(inputs.every((input) => /\sdisabled=""/.test(input))).toBe(true);
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*\sdisabled=""/);
  });

  test('summary includes implied read permissions', () => {
    const html = renderToStaticMarkup(React.createElement(ui.PermissionSummary, { scopes: ['points:write'], groups: ui.getScopeGroups() }));
    expect(html).toContain('조회 1 · 수정 1');
    expect(html).toContain('포인트');
  });
});

describe('Bot manager UI account isolation', () => {
  test('deduplicates members by account identity and tolerates missing arrays', () => {
    expect(ui.uniqueMembers(null)).toEqual([]);
    expect(ui.uniqueMembers({})).toEqual([]);
    const members = ui.uniqueMembers([null, { id: 'first', memberUserId: 'user-a' }, { id: 'second', memberUserId: 'user-a' }, { id: 'third', memberUserId: 'user-b' }, { id: 'bad' }]);
    expect(members.map((member) => member.id)).toEqual(['second', 'third']);
  });

  test('search is bounded and duplicate provider rows share one account choice', () => {
    const users = [{ userId: 'same' }, { userId: 'same' }, null, {}, ...Array.from({ length: 50 }, (_, i) => ({ userId: `user-${i}` }))];
    const result = ui.uniqueSearchUsers(users);
    expect(result).toHaveLength(20);
    expect(result.filter((user) => user.userId === 'same')).toHaveLength(1);
    expect(ui.uniqueSearchUsers(null)).toEqual([]);
  });

  test('even a full-access manager cannot edit the roster', () => {
    context = { active: { ownerUserId: 'owner-a', displayName: '채널 A', role: 'manager', scopes: ['*'] }, canManageMembers: true, isSiteAdmin: false };
    expect(ui.BotManagersPage().props.allowed).toBe(false);
  });

  test('owners need context permission and site administrators can manage the roster', () => {
    context = { active: { ownerUserId: 'owner-a', displayName: '채널 A', role: 'owner', scopes: ['*'] }, canManageMembers: true, isSiteAdmin: false };
    expect(ui.BotManagersPage().props.allowed).toBe(true);
    context.canManageMembers = false;
    expect(ui.BotManagersPage().props.allowed).toBe(false);
    context.active.role = 'site_admin';
    context.isSiteAdmin = true;
    expect(ui.BotManagersPage().props.allowed).toBe(true);
  });

  test('channel and access changes remount state rather than retaining old dialogs', () => {
    context = { active: { ownerUserId: 'owner-a', displayName: '채널 A', role: 'owner', scopes: ['*'] }, canManageMembers: true, isSiteAdmin: false };
    const first = ui.BotManagersPage();
    expect(first.props.channelName).toBe('채널 A');
    context.active.ownerUserId = 'owner-b';
    expect(ui.BotManagersPage().key).not.toBe(first.key);
    const second = ui.BotManagersPage();
    context.canManageMembers = false;
    expect(ui.BotManagersPage().key).not.toBe(second.key);
  });

  test('no active channel never mounts a roster request', () => {
    context = { active: null, canManageMembers: false, isSiteAdmin: false };
    expect(renderToStaticMarkup(ui.BotManagersPage())).toContain('관리할 채널을 선택해 주세요.');
  });
});
