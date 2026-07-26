const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

describe('attendance message variables', () => {
  const root = path.join(__dirname, '..');
  const moduleUrl = pathToFileURL(path.join(root, 'server', 'attendance-message.js')).href;
  const specialModuleUrl = pathToFileURL(path.join(root, 'server', 'attendance-special-variables.js')).href;
  const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const commandsPage = fs.readFileSync(
    path.join(root, 'src', 'features', 'admin', 'commands-page.tsx'),
    'utf8'
  );
  const variableHelp = fs.readFileSync(
    path.join(root, 'src', 'features', 'admin', 'command-variable-help.tsx'),
    'utf8'
  );

  function runScenario() {
    const source = `
      const attendance = await import(${JSON.stringify(moduleUrl)});
      const special = await import(${JSON.stringify(specialModuleUrl)});
      const resolved = await attendance.renderAttendanceTemplate(
        '{user.name} {attendance.streak}/{attendance.totalDays} {user.points}P 팔로우 {user.followedDays}일',
        { username: '아루', userId: 'viewer-1', streak: 3, totalDays: 7, points: 100, date: '2026-07-26' },
        async (message) => message.replaceAll('{user.points}', '1250').replaceAll('{user.followedDays}', '42')
      );
      const fallback = await attendance.renderAttendanceTemplate(
        '{user.name}/{user.username} {attendance.date} {user.points}P {user.followedDays}일 {user.followedAt} {user.subscriptionMonths} {channel.followers}',
        { username: '테스터', date: '2026-07-26' },
        async () => { throw new Error('optional lookup failed'); }
      );
      const limited = await attendance.renderAttendanceTemplate(
        '{user.points}',
        { userId: 'viewer-1' },
        async () => '가'.repeat(120)
      );
      const timedOut = await attendance.renderAttendanceTemplate(
        '{user.points}',
        { userId: 'viewer-1' },
        async () => new Promise(() => {}),
        { substitutionTimeoutMs: 10 }
      );
      const roulette = [];
      const action = [];
      const executed = await special.processAttendanceSpecialVariables(
        '출석 완료 \${roulette::행운} \${roulette::행운} \${action::환영} \${automation::환영}',
        {
          execute: true,
          onRoulette: async (operation) => roulette.push(operation),
          onAction: async (operation) => action.push(operation),
        }
      );
      const skipped = await special.processAttendanceSpecialVariables(
        '\${roulette::행운}\${blueprint::환영}',
        {
          execute: false,
          onRoulette: async () => roulette.push('unexpected'),
          onAction: async () => action.push('unexpected'),
        }
      );
      const continued = [];
      const isolatedFailure = await special.processAttendanceSpecialVariables(
        '\${roulette::오류}\${action::계속}',
        {
          execute: true,
          onRoulette: async () => { throw new Error('roulette failed'); },
          onAction: async (operation) => continued.push(operation),
        }
      );
      const injectedCalls = [];
      const injectedPlan = special.extractAttendanceSpecialVariables('{user.name} 출석');
      const injectedText = await attendance.renderAttendanceTemplate(
        injectedPlan.text,
        { username: '\${action::위험액션}' },
        null,
        { allowEmptyTemplate: true, maxLength: null }
      );
      const injectedExecution = await special.executeAttendanceSpecialOperations(injectedPlan.operations, {
        execute: true,
        onAction: async (operation) => injectedCalls.push(operation),
      });
      const aliases = [];
      await special.processAttendanceSpecialVariables(
        '\${automation::자동화}\${blueprint::블루프린트}',
        { execute: true, onAction: async (operation) => aliases.push(operation) }
      );
      const tokenOnlyPlan = special.extractAttendanceSpecialVariables('\${action::단독}');
      const tokenOnlyText = await attendance.renderAttendanceTemplate(
        tokenOnlyPlan.text,
        {},
        null,
        { allowEmptyTemplate: true, maxLength: null }
      );
      console.log(JSON.stringify({
        resolved, fallback, limited, timedOut, roulette, action, executed, skipped, continued,
        isolatedFailure, injectedCalls, injectedPlan, injectedText, injectedExecution,
        aliases, tokenOnlyText,
      }));
    `;
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: root,
      encoding: 'utf8',
    }).trim());
  }

  const scenario = runScenario();

  test('resolves attendance values before the shared user variable resolver', () => {
    expect(scenario.resolved).toBe('아루 3/7 1250P 팔로우 42일');
  });

  test('keeps the attendance response available when an optional lookup fails', () => {
    expect(scenario.fallback).toBe('테스터/테스터 2026-07-26 0P 0일 확인할 수 없음');
    expect(scenario.fallback).not.toMatch(/\{(?:user|live|channel)\./);
  });

  test('applies the 100 character limit after every value has been substituted', () => {
    expect(scenario.limited).toHaveLength(100);
    expect(scenario.limited).toBe('가'.repeat(100));
  });

  test('falls back instead of blocking attendance when an optional lookup exceeds its deadline', () => {
    expect(scenario.timedOut).toBe('0');
  });

  test('runs attendance roulette and action tokens once and strips them from chat', () => {
    expect(scenario.executed.text).toBe('출석 완료');
    expect(scenario.roulette).toEqual([{ type: 'roulette', target: '행운' }]);
    expect(scenario.action).toEqual([{ type: 'action', target: '환영' }]);
  });

  test('strips special tokens without executing them for an already-recorded attendance', () => {
    expect(scenario.skipped.text).toBe('');
    expect(scenario.skipped.executed).toEqual([]);
    expect(scenario.roulette).toHaveLength(1);
    expect(scenario.action).toHaveLength(1);
  });

  test('isolates one special execution failure so the remaining attendance actions continue', () => {
    expect(scenario.isolatedFailure.text).toBe('');
    expect(scenario.isolatedFailure.errors).toHaveLength(1);
    expect(scenario.continued).toEqual([{ type: 'action', target: '계속' }]);
  });

  test('never promotes a viewer or live value into an executable attendance token', () => {
    expect(scenario.injectedPlan.operations).toEqual([]);
    expect(scenario.injectedText).toBe('${action::위험액션} 출석');
    expect(scenario.injectedExecution.executed).toEqual([]);
    expect(scenario.injectedCalls).toEqual([]);
  });

  test('routes both action aliases and preserves an empty token-only chat response', () => {
    expect(scenario.aliases).toEqual([
      { type: 'automation', target: '자동화' },
      { type: 'blueprint', target: '블루프린트' },
    ]);
    expect(scenario.tokenOnlyText).toBe('');
  });

  test('all attendance paths await provider-scoped shared placeholder substitution', () => {
    expect(serverIndex).toContain('async function renderAttendanceMessage');
    expect(serverIndex).toContain('const rendered = await renderAttendanceTemplate(specialPlan.text, context, (message) =>');
    expect(serverIndex).toContain('substituteAllPlaceholders(message, context.sid, context.userId, context.username, {');
    expect(serverIndex).toContain('attendanceDays: context.totalDays');
    expect(serverIndex.match(/await renderAttendanceMessage\(/g)?.length || 0).toBeGreaterThanOrEqual(4);
    expect(serverIndex.match(/recordAttendanceFromCommand\(\{/g)?.length || 0).toBeGreaterThanOrEqual(6);
    expect(serverIndex).toContain("provider: 'chzzk'");
    expect(serverIndex).toContain("provider: 'youtube'");
    expect(serverIndex).toContain("provider: 'cime'");
  });

  test('executes attendance special variables only for a newly persisted attendance', () => {
    expect(serverIndex).toContain('const specialPlan = extractAttendanceSpecialVariables(configuredTemplate);');
    expect(serverIndex).toContain('executeAttendanceSpecialOperations(specialPlan.operations, {');
    expect(serverIndex).toContain('executeSpecialVariables: result?.isNew === true');
    expect(serverIndex.match(/executeSpecialVariables: result\?\.isNew === true/g)?.length || 0).toBe(4);
    expect(serverIndex).toContain("source: 'attendance'");
    expect(serverIndex).toContain('enqueueRouletteSpin(context.sid, {');
    expect(serverIndex).toContain('executeActionVariableTokens(context.sid, token, {');
    expect(serverIndex).toContain('requirePublishedBlueprint: true');
    expect(serverIndex).toContain("throw new Error(failed.error || failed.result?.error || 'attendance_action_failed');");
    expect(serverIndex).toContain("return String(rendered || '').trim().slice(0, 100);");
    expect(serverIndex).toContain('const blueprints = await listActionBlueprints(owner).catch(() => []);');
    expect(serverIndex).toContain("String(candidate?.name || '').trim().toLocaleLowerCase('ko-KR') === normalizedReference");
    expect(serverIndex).toContain("String(candidate?.id || '').trim().toLocaleLowerCase('ko-KR') === rouletteReference");
  });

  test('keeps special execution active when only the attendance chat message is hidden', () => {
    const chzzkAuto = serverIndex.slice(
      serverIndex.indexOf('// Attendance: only when actually live.'),
      serverIndex.indexOf('// Channel Points: when live')
    );
    const youtubeAuto = serverIndex.slice(
      serverIndex.indexOf('async function processYoutubeChatAutomation'),
      serverIndex.indexOf('if (isBotSelf || settings.botEnabled === false)')
    );
    const cimeAuto = serverIndex.slice(
      serverIndex.indexOf('async function processCimeChatAutomation'),
      serverIndex.indexOf('if (settings.botEnabled === false)', serverIndex.indexOf('async function processCimeChatAutomation'))
    );

    expect(chzzkAuto.indexOf('await renderAttendanceMessage')).toBeLessThan(chzzkAuto.indexOf('if (shouldAnnounce &&'));
    expect(youtubeAuto.indexOf('await renderAttendanceMessage')).toBeLessThan(youtubeAuto.indexOf('if (settings.attendanceAnnounce !== false && reply)'));
    expect(cimeAuto.indexOf('await renderAttendanceMessage')).toBeLessThan(cimeAuto.indexOf('if (settings.attendanceAnnounce !== false && attendanceText)'));
  });

  test('attendance settings expose the applicable variable help instead of a six-variable claim', () => {
    expect(commandsPage).toContain('<CommandVariableHelpButton scope="attendance" />');
    expect(commandsPage).toContain('시청자·출석·방송·채널 변수');
    expect(commandsPage).toContain('룰렛·실행 액션');
    expect(commandsPage).not.toContain('사용 가능한 변수: <code>');
    expect(variableHelp).toContain("scope?: 'command' | 'attendance'");
    expect(variableHelp).toContain("ATTENDANCE_VARIABLE_GROUPS.has(variable.group)");
    expect(variableHelp).toContain('ATTENDANCE_SPECIAL_VARIABLES.has(variable.key)');
  });
});
