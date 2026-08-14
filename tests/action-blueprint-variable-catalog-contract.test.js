const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');

function expectedKstDday(targetDate, timestamp = Date.now()) {
  const today = new Date(timestamp + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  return String((Date.parse(`${targetDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (24 * 60 * 60 * 1000));
}

const BLUEPRINT_READ_CONTRACT = Object.freeze({
  context: Object.freeze({
    '{user.name}': '테스트 시청자',
    '{user.id}': 'viewer-1',
    '{user.username}': '테스트 시청자',
    '{user.nickname}': '테스트 시청자',
    '{attendance.points}': '75',
    '{attendance.date}': '2026-08-13',
    '{trigger.message}': '!테스트 인자',
    '{trigger.keyword}': '!테스트',
    '{trigger.platform}': 'cime',
    '{user.userId}': 'viewer-1',
    '{channel.channelUid}': 'channel-1',
    '{donation.amount}': '2500',
    '{roulette.result.label}': '당첨 항목',
    '{roulette.result.value}': '당첨 값',
  }),
  resolver: Object.freeze({
    '{user.points}': '1250',
    '{user.channelPoints}': '1250',
    '{user.attendanceDays}': '9',
    '{attendance.streak}': '3',
    '{attendance.totalDays}': '9',
    '{user.followedAt}': '2026-08-10',
    '{user.followedDays}': '4',
    '{user.subscriptionMonths}': '6',
    '{live.title}': '실제 방송 제목',
    '{live.category}': '게임',
    '{live.viewers}': '321',
    '{live.startedAt}': '2026-08-13 10:00',
    '{live.elapsed}': '01:02:03',
    '{live.elapsed_ko}': '1시간 2분 3초',
    '{live.channel}': '아루 채널',
    '{channel.followers}': '777',
  }),
  runtime: Object.freeze({
    '{node.rouletteRun.result.label}': '노드 당첨 항목',
    '{node.rouletteRun.result.value}': '노드 당첨 값',
    '{node.attendanceGet.totalDays}': '11',
    '{node.pointsGet.points}': '1700',
    '{node.overlay.overlayId}': 'overlay-1',
    '{flow.변수이름}': '임시 값',
  }),
  dynamic: Object.freeze({
    '${dday::2026-08-14}': expectedKstDday('2026-08-14'),
  }),
});

function parseBotVariableCatalog(source) {
  const start = source.indexOf('const BOT_VARIABLES = [');
  const end = source.indexOf('\n];', start);
  if (start < 0 || end < 0) throw new Error('BOT_VARIABLES catalog was not found');

  return source.slice(start, end).split(/\r?\n/).flatMap((line) => {
    const key = line.match(/\bkey:\s*'([^']+)'/)?.[1];
    if (!key) return [];
    const contextSource = line.match(/\bcontexts:\s*\[([^\]]*)\]/)?.[1];
    const contexts = contextSource == null
      ? null
      : Array.from(contextSource.matchAll(/'([^']+)'/g), (match) => match[1]);
    return [{ key, contexts }];
  });
}

function contractEntries() {
  return Object.entries(BLUEPRINT_READ_CONTRACT).flatMap(([source, values]) => (
    Object.entries(values).map(([key, expected]) => ({ key, expected, source }))
  ));
}

describe('action blueprint variable catalog contract', () => {
  const catalog = parseBotVariableCatalog(serverIndex);
  const visibleInBlueprint = catalog.filter(({ contexts }) => contexts == null || contexts.includes('blueprint'));
  const expectedEntries = contractEntries();

  test('classifies every read-only variable exposed to blueprints without omissions', () => {
    const expectedKeys = expectedEntries.map(({ key }) => key).sort();
    const visibleKeys = visibleInBlueprint.map(({ key }) => key).sort();

    expect(new Set(expectedKeys).size).toBe(expectedKeys.length);
    expect(visibleKeys).toEqual(expectedKeys);
  });

  test('keeps every special execution token out of the blueprint variable scope', () => {
    const specialTokens = catalog.filter(({ key }) => key.startsWith('${') && !/^\$\{dday::/i.test(key));

    expect(specialTokens.length).toBeGreaterThan(0);
    expect(specialTokens.every(({ contexts }) => Array.isArray(contexts) && !contexts.includes('blueprint'))).toBe(true);
    expect(visibleInBlueprint.filter(({ key }) => key.startsWith('${')).map(({ key }) => key)).toEqual(['${dday::2026-08-14}']);
  });

  test('hydrates and renders the contracted context, resolver, and runtime values', () => {
    const moduleUrl = new URL('../server/action-blueprint-values.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const keys = expectedEntries.map(({ key }) => key);
    const script = `
      const values = await import(${JSON.stringify(moduleUrl)});
      const keys = ${JSON.stringify(keys)};
      const calls = [];
      const record = (family, result) => async (args) => {
        calls.push({
          family,
          provider: args.provider,
          userId: args.userId,
          channelUid: args.context?.channelUid || args.context?.channel?.channelUid || '',
        });
        return result;
      };
      const hydrated = await values.hydrateBlueprintReadContext({
        context: {
          platform: 'cime',
          command: { text: '!테스트 인자', keyword: '!테스트' },
          user: { userId: 'viewer-1', username: '테스트 시청자' },
          channelUid: 'channel-1',
          result: { label: '당첨 항목', value: '당첨 값' },
          donation: { amount: 2500 },
          attendance: { points: 75, date: '2026-08-13' },
        },
        value: keys,
        resolvers: {
          loadUserPoints: record('points', 1250),
          loadAttendanceSummary: record('attendance', { streak: 3, totalDays: 9 }),
          loadFollowedAt: record('follow', { followedAt: '2026-08-10', followedDays: 4 }),
          loadSubscriptionMonths: record('subscription', 6),
          loadLiveInfo: record('live', {
            title: '실제 방송 제목',
            category: '게임',
            viewers: 321,
            startedAt: '2026-08-13 10:00',
            elapsed: '01:02:03',
            elapsed_ko: '1시간 2분 3초',
            channel: '아루 채널',
          }),
          loadFollowerCount: record('followers', 777),
        },
        memo: new Map(),
        currentDate: '2026-08-13',
      });
      const scope = values.buildBlueprintScope(
        hydrated,
        { 변수이름: '임시 값' },
        {
          rouletteRun: { result: { label: '노드 당첨 항목', value: '노드 당첨 값' } },
          attendanceGet: { totalDays: 11 },
          pointsGet: { points: 1700 },
          overlay: { overlayId: 'overlay-1' },
        }
      );
      const rendered = Object.fromEntries(keys.map((key) => [key, values.renderBlueprintTemplate(key, scope)]));
      console.log(JSON.stringify({ rendered, calls }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root,
      encoding: 'utf8',
    }).trim());

    expect(result.rendered).toEqual(Object.fromEntries(expectedEntries.map(({ key, expected }) => [key, expected])));
    expect(result.calls.map(({ family }) => family).sort()).toEqual([
      'attendance',
      'follow',
      'followers',
      'live',
      'points',
      'subscription',
    ]);
    for (const call of result.calls) {
      expect(call).toMatchObject({ provider: 'cime', userId: 'viewer-1', channelUid: 'channel-1' });
    }
  });
});
