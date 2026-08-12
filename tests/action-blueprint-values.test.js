const path = require('path');
const { execFileSync } = require('child_process');

describe('action blueprint value hydration', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/action-blueprint-values.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const values = await import(${JSON.stringify(moduleUrl)});

      const createResolvers = (pointValue = 1000) => {
        const calls = { points: 0, attendance: 0, follow: 0, subscription: 0, live: 0, followers: 0 };
        return {
          calls,
          resolvers: {
            loadUserPoints: async () => { calls.points += 1; return pointValue; },
            loadAttendanceSummary: async () => { calls.attendance += 1; return { streak: 4, totalDays: 12 }; },
            loadFollowedAt: async () => { calls.follow += 1; return { followedAt: '2026-08-01', followedDays: 13 }; },
            loadSubscriptionMonths: async () => { calls.subscription += 1; return 8; },
            loadLiveInfo: async () => {
              calls.live += 1;
              return { title: '실제 방송', category: '게임', viewers: 321, startedAt: '2026-08-13 10:00', elapsed: '01:02:03', elapsed_ko: '1시간 2분 3초', channel: '아루', live: true };
            },
            loadFollowerCount: async () => { calls.followers += 1; return 777; },
          },
        };
      };

      const boundaries = {};
      for (const points of [999, 1000, 1001]) {
        const fixture = createResolvers(points);
        const context = await values.hydrateBlueprintReadContext({
          context: { platform: 'youtube', user: { userId: 'viewer-1', username: '시청자', points: 999999 }, channelUid: 'channel-1' },
          value: { left: '{user.points}', right: '1000' },
          resolvers: fixture.resolvers,
          memo: new Map(),
          currentDate: '2026-08-13',
        });
        const scope = values.buildBlueprintScope(context);
        const left = values.evaluateBlueprintValue('{user.points}', scope);
        boundaries[points] = {
          passed: await values.compareBlueprintValues(left, 'gte', 1000),
          left,
          channelPoints: context.user.channelPoints,
          calls: fixture.calls.points,
        };
      }

      const fixture = createResolvers(1500);
      const memo = new Map();
      let hydrated = await values.hydrateBlueprintReadContext({
        context: {
          platform: 'cime',
          command: { text: '명령 전체 문장', keyword: '포인트' },
          user: { userId: 'viewer-2', username: '닉네임' },
          channelUid: 'channel-2',
          result: { label: '당첨', value: '보상' },
        },
        value: {
          user: '{user.points}/{user.channelPoints}/{user.attendanceDays}/{user.followedAt}/{user.followedDays}/{user.subscriptionMonths}',
          attendance: '{attendance.streak}/{attendance.totalDays}/{attendance.points}/{attendance.date}',
          live: '{live.title}/{live.category}/{live.viewers}/{live.startedAt}/{live.elapsed}/{live.elapsed_ko}/{live.channel}',
          channel: '{channel.followers}',
        },
        resolvers: fixture.resolvers,
        memo,
        currentDate: '2026-08-13',
      });
      hydrated = await values.hydrateBlueprintReadContext({
        context: hydrated,
        value: '{user.points}/{live.title}/{channel.followers}',
        resolvers: fixture.resolvers,
        memo,
        currentDate: '2026-08-13',
      });
      const hydratedScope = values.buildBlueprintScope(hydrated, { 한글키: '정상' }, {});

      const unusedFixture = createResolvers(1000);
      const unused = await values.hydrateBlueprintReadContext({
        context: { user: { userId: 'viewer-3', username: '미사용' } },
        value: { left: '{user.name}', right: '{trigger.keyword}' },
        resolvers: unusedFixture.resolvers,
      });

      const dryFixture = createResolvers(9000);
      const dryRun = await values.hydrateBlueprintReadContext({
        context: { user: { userId: 'test', username: '테스트', points: 0 }, attendance: { totalDays: 3 } },
        value: '{user.points}/{user.attendanceDays}/{attendance.date}',
        dryRun: true,
        resolvers: dryFixture.resolvers,
        currentDate: '2026-08-13',
      });

      let invalidPointCode = null;
      try {
        const invalid = createResolvers(null);
        await values.hydrateBlueprintReadContext({
          context: { user: { userId: 'viewer-4' } },
          value: '{user.points}',
          resolvers: invalid.resolvers,
        });
      } catch (error) {
        invalidPointCode = error.code;
      }

      const regexComparisons = {
        safeMatch: await values.compareBlueprintValues('viewer-1000', 'regex', '^viewer-[0-9]+$'),
        safeMiss: await values.compareBlueprintValues('streamer', 'regex', '^viewer-[0-9]+$'),
      };
      for (const [key, left, pattern] of [
        ['nestedQuantifier', 'a'.repeat(64) + '!', '(a+)+$'],
        ['invalid', 'value', '['],
        ['oversizedPattern', 'value', 'a'.repeat(257)],
        ['oversizedInput', 'a'.repeat(4097), '^a+$'],
      ]) {
        try {
          await values.compareBlueprintValues(left, 'regex', pattern);
          regexComparisons[key] = 'unexpected_success';
        } catch (error) {
          regexComparisons[key] = error.code;
        }
      }
      let heartbeats = 0;
      const heartbeat = setInterval(() => { heartbeats += 1; }, 10);
      try {
        await values.compareBlueprintValues('a'.repeat(48) + '!', 'regex', '(a|aa)+$');
        regexComparisons.ambiguousAlternation = 'unexpected_success';
      } catch (error) {
        regexComparisons.ambiguousAlternation = error.code;
      } finally {
        clearInterval(heartbeat);
      }
      regexComparisons.heartbeats = heartbeats;
      regexComparisons.recovered = await values.compareBlueprintValues('viewer-42', 'regex', '^viewer-[0-9]+$');

      console.log(JSON.stringify({
        boundaries,
        aliases: {
          user: hydrated.user,
          trigger: hydrated.trigger,
          channelUid: hydrated.channel.channelUid,
          roulette: hydrated.roulette,
        },
        rendered: {
          all: values.renderBlueprintTemplate(
            '{user.points}|{user.attendanceDays}|{user.followedAt}|{user.followedDays}|{user.subscriptionMonths}|{attendance.streak}|{attendance.totalDays}|{attendance.points}|{attendance.date}|{live.title}|{channel.followers}',
            hydratedScope
          ),
          koreanFlow: values.renderBlueprintTemplate('{flow.한글키}', hydratedScope),
          specialToken: values.renderBlueprintTemplate('$' + '{live.title_change}', hydratedScope),
          roulette: values.renderBlueprintTemplate('{roulette.result.label}/{roulette.result.value}', hydratedScope),
          prototype: values.renderBlueprintTemplate('{user.constructor}', hydratedScope),
        },
        resolverCalls: fixture.calls,
        unused: { context: unused, calls: unusedFixture.calls },
        dryRun: { context: dryRun, calls: dryFixture.calls },
        invalidPointCode,
        comparisons: {
          blank: await values.compareBlueprintValues('', 'gte', 1000),
          mixed: await values.compareBlueprintValues('abc', 'gte', 1000),
          formatted: await values.compareBlueprintValues('1,000', 'gte', 1000),
          date: await values.compareBlueprintValues('2026-08-13', 'gte', '2026-08-01'),
        },
        regexComparisons,
        paths: Array.from(values.collectBlueprintReadPaths({ a: '{user.points}', b: '$' + '{live.title_change}', c: '{flow.한글키}' })).sort(),
      }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());
  });

  test('hydrates the authoritative balance and passes the exact 1000-point boundary', () => {
    expect(result.boundaries).toEqual({
      999: { passed: false, left: 999, channelPoints: 999, calls: 1 },
      1000: { passed: true, left: 1000, channelPoints: 1000, calls: 1 },
      1001: { passed: true, left: 1001, channelPoints: 1001, calls: 1 },
    });
  });

  test('normalizes user, command trigger, channel, and roulette result aliases', () => {
    expect(result.aliases.user).toMatchObject({
      userId: 'viewer-2', id: 'viewer-2', username: '닉네임', name: '닉네임', nickname: '닉네임',
    });
    expect(result.aliases.trigger).toMatchObject({ message: '명령 전체 문장', keyword: '포인트', platform: 'cime' });
    expect(result.aliases.channelUid).toBe('channel-2');
    expect(result.aliases.roulette.result).toEqual({ label: '당첨', value: '보상' });
  });

  test('loads every external read-variable family once and renders its current value', () => {
    expect(result.resolverCalls).toEqual({ points: 1, attendance: 1, follow: 1, subscription: 1, live: 1, followers: 1 });
    expect(result.rendered.all).toBe('1500|12|2026-08-01|13|8|4|12|0|2026-08-13|실제 방송|777');
    expect(result.rendered.roulette).toBe('당첨/보상');
  });

  test('supports Unicode flow keys without consuming special execution tokens', () => {
    expect(result.rendered.koreanFlow).toBe('정상');
    expect(result.rendered.specialToken).toBe('${live.title_change}');
    expect(result.rendered.prototype).toBe('');
    expect(result.paths).toEqual(['flow.한글키', 'user.points']);
  });

  test('does not query unrelated variable families or production data in dry-run', () => {
    expect(result.unused.calls).toEqual({ points: 0, attendance: 0, follow: 0, subscription: 0, live: 0, followers: 0 });
    expect(result.unused.context.user.name).toBe('미사용');
    expect(result.dryRun.calls).toEqual({ points: 0, attendance: 0, follow: 0, subscription: 0, live: 0, followers: 0 });
    expect(result.dryRun.context.user).toMatchObject({ points: 0, channelPoints: 0, attendanceDays: 3 });
    expect(result.dryRun.context.attendance.date).toBe('2026-08-13');
  });

  test('rejects an invalid stored balance instead of treating it as zero', () => {
    expect(result.invalidPointCode).toBe('blueprint_user_points_invalid');
  });

  test('fails closed for blank or mixed relational operands while retaining numeric and date comparisons', () => {
    expect(result.comparisons).toEqual({ blank: false, mixed: false, formatted: true, date: true });
  });

  test('isolates regular expressions and recovers after unsafe or timed-out patterns', () => {
    expect(result.regexComparisons).toEqual({
      safeMatch: true,
      safeMiss: false,
      nestedQuantifier: 'blueprint_regex_unsafe',
      invalid: 'blueprint_regex_invalid',
      ambiguousAlternation: 'blueprint_regex_timeout',
      oversizedPattern: 'blueprint_regex_pattern_too_long',
      oversizedInput: 'blueprint_regex_input_too_long',
      heartbeats: expect.any(Number),
      recovered: true,
    });
    expect(result.regexComparisons.heartbeats).toBeGreaterThan(0);
  });
});

describe('action blueprint runtime integration', () => {
  test('hydrates reached node configs centrally and no longer masks point/attendance read failures as zero', () => {
    const source = require('fs').readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
    const start = source.indexOf('async function executeActionBlueprint');
    const end = source.indexOf('const PVD_PROVIDER_KEYS', start);
    const runtime = source.slice(start, end);

    expect(runtime).toContain('const hydratedContext = await hydrateBlueprintReadContext({');
    expect(runtime).toContain('runtimeContext = mergeBlueprintReadContexts(runtimeContext, hydratedContext)');
    expect(runtime).toContain('value: config,');
    expect(runtime).toContain('buildBlueprintScope(runtimeContext, flow, nodeOutputs)');
    expect(runtime).toContain('await getChannelPoints(channelUid, userId)');
    expect(runtime).not.toContain('getChannelPoints(channelUid, userId).catch(() => 0)');
    expect(runtime).not.toContain('getUserAttendanceTotalDays(sid, userId).catch(() => 0)');
  });

  test('resolves production point balances by the trigger platform and keeps manual tests off real balance tables', () => {
    const source = require('fs').readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
    const resolverStart = source.indexOf('async function resolveBlueprintChannelUid');
    const resolverEnd = source.indexOf('const BLUEPRINT_VARIABLE_LOOKUP_TIMEOUT_MS', resolverStart);
    const resolver = source.slice(resolverStart, resolverEnd);
    const runtimeStart = source.indexOf('async function executeActionBlueprint');
    const runtimeEnd = source.indexOf('const PVD_PROVIDER_KEYS', runtimeStart);
    const runtime = source.slice(runtimeStart, runtimeEnd);

    expect(resolver).toContain("const supportedProvider = ['chzzk', 'cime', 'youtube'].includes(provider) ? provider : ''");
    expect(resolver).toContain('resolveStreamerUidForSid(sid, supportedProvider)');
    expect(resolver).toContain("error.code = 'blueprint_channel_identity_unavailable'");
    expect(source).toContain('strict: true,');
    expect(source).toContain('if (options?.strict === true) throw error;');
    expect(runtime).toContain("? (simulatedUser ? Number(runtimeContext.user?.points ?? runtimeContext.user?.channelPoints ?? 0) : 0)");
    expect(runtime).toContain("const page = dryRun\n          ? { rows: [] }");
    expect(runtime).toContain('const excluded = dryRun');
    expect(runtime).toContain('const totalDays = dryRun');
  });
});
