const fs = require('fs');
const path = require('path');

describe('bot rules API regression', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const commandsPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'commands-page.tsx'), 'utf8');

  test('bot rule management uses logged-in owner sid without requiring CHZZK channel validation', () => {
    const helperStart = serverIndex.indexOf('async function getBotRulesOwnerSid');
    const helperEnd = serverIndex.indexOf('async function requireCurrentAdminUser', helperStart);
    const helper = serverIndex.slice(helperStart, helperEnd);

    expect(helper).toContain('getPartitionIdByApiKey(req)');
    expect(helper).toContain('getCurrentSessionUserId(req)');
    expect(helper).toContain('`user:${String(ownerUserId)}`');
    expect(helper).not.toContain('resolveChannelIdForOwnerUserId');

    const routesStart = serverIndex.indexOf("app.get('/api/bot/rules'");
    const routesEnd = serverIndex.indexOf('// --- Channel Points endpoints ---', routesStart);
    const routes = serverIndex.slice(routesStart, routesEnd);

    expect(routes).toContain('getBotRulesOwnerSid(req, res)');
    expect(routes).not.toContain('getPartitionId(req, res)');
  });

  test('commands page surfaces bot rule load and save failures', () => {
    expect(commandsPage).toContain('명령어를 불러오지 못했습니다. 로그인 상태를 확인해 주세요.');
    expect(commandsPage).toContain("data?.message || data?.error || 'request_failed'");
    expect(commandsPage).toContain("getApiErrorMessage(error, '명령어를 저장하지 못했어요.')");
  });
});
