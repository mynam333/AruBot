const path = require('path');
const { execFileSync } = require('child_process');

describe('counter variables', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/counter-variables.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const counters = await import(${JSON.stringify(moduleUrl)});
      const sentinelFactory = ({ index }) => '<<COUNTER:' + index + '>>';

      const normalized = {
        nfkc: counters.normalizeCounterVariableName('  Ａｂｃ　승   리  '),
        korean: counters.normalizeCounterVariableName('출석.연속-합계_1'),
        invalidSlash: counters.normalizeCounterVariableName('출석/합계'),
        invalidColon: counters.normalizeCounterVariableName('출석::합계'),
        tooLong: counters.normalizeCounterVariableName('가'.repeat(65)),
        exactLimit: counters.normalizeCounterVariableName('가'.repeat(64)),
      };

      const plan = counters.prepareCounterVariablePlan(
        'A \${counter::user::  승   리 } B \${counter::USER::승리} C '
          + '\${ counter :: global :: 승리 } D \${counter::team::무시} '
          + '\${counter::global::잘못/이름} E \${counter::global::승리}',
        { createSentinel: sentinelFactory }
      );
      const calls = [];
      const resolved = await counters.resolveCounterVariablePlan(plan, plan.text, {
        provider: 'YouTube',
        userId: 'youtube:youtube:viewer-1',
        incrementCounter: async (entry) => {
          calls.push(entry);
          return entry.scope === 'user' ? 7 : '00101';
        },
      });

      const removedPlan = counters.prepareCounterVariablePlan(
        '\${counter::user::남은값} \${counter::global::삭제됨}',
        { createSentinel: sentinelFactory }
      );
      const removedCalls = [];
      const removedText = removedPlan.text.replace(removedPlan.entries[1].sentinel, '');
      const removed = await counters.resolveCounterVariablePlan(removedPlan, removedText, {
        provider: 'chzzk',
        userId: 'viewer-2',
        incrementCounter: async (entry) => {
          removedCalls.push(entry);
          return 3;
        },
      });

      const injectionPlan = counters.prepareCounterVariablePlan(
        '정상 \${counter::global::safe}',
        { createSentinel: sentinelFactory }
      );
      const injectionCalls = [];
      const injected = await counters.resolveCounterVariablePlan(
        injectionPlan,
        injectionPlan.text + ' 닉네임=\${counter::global::hacked}',
        {
          incrementCounter: async (entry) => {
            injectionCalls.push(entry);
            return 9;
          },
        }
      );

      const failurePlan = counters.prepareCounterVariablePlan(
        '\${counter::global::정상}/\${counter::user::DB오류}/\${counter::global::잘못된결과}',
        { createSentinel: sentinelFactory }
      );
      const failed = await counters.resolveCounterVariablePlan(failurePlan, failurePlan.text, {
        provider: 'cime',
        userId: '1033927',
        incrementCounter: async (entry) => {
          if (entry.name === 'DB오류') throw new Error('temporary database failure');
          if (entry.name === '잘못된결과') return 'not-a-number';
          return 42n;
        },
      });

      const unknownPlan = counters.prepareCounterVariablePlan(
        '\${counter::user::개인}/\${counter::global::전체}',
        { createSentinel: sentinelFactory }
      );
      const unknownCalls = [];
      const unknown = await counters.resolveCounterVariablePlan(unknownPlan, unknownPlan.text, {
        provider: 'youtube',
        userId: 'unknown_user',
        incrementCounter: async (entry) => {
          unknownCalls.push(entry);
          return 5;
        },
      });

      const identities = {};
      for (const [key, provider, userId] of [
        ['plain', 'youtube', 'viewer'],
        ['qualified', 'youtube', 'youtube:viewer'],
        ['ownerQualified', 'youtube', 'user:youtube:viewer'],
        ['duplicate', 'youtube', 'youtube:youtube:viewer'],
      ]) {
        identities[key] = counters.qualifyCounterUserSubject(provider, userId);
      }
      for (const [key, provider, userId] of [
        ['missing', 'youtube', ''],
        ['unknown', 'youtube', 'unknown_user'],
        ['mismatch', 'youtube', 'cime:123'],
        ['nestedMismatch', 'youtube', 'youtube:cime:123'],
        ['provider', 'other', 'viewer'],
      ]) {
        try {
          counters.qualifyCounterUserSubject(provider, userId);
          identities[key] = 'accepted';
        } catch (error) {
          identities[key] = error.message;
        }
      }

      const firstRandomPlan = counters.prepareCounterVariablePlan('\${counter::global::random}');
      const secondRandomPlan = counters.prepareCounterVariablePlan('\${counter::global::random}');
      const malformedPlan = counters.prepareCounterVariablePlan('앞 \${counter::global::a{b}} 뒤');
      const nestedMalformedPlan = counters.prepareCounterVariablePlan('앞 \${counter::global::a{b{c}}} 뒤');
      const multilineMalformedPlan = counters.prepareCounterVariablePlan('앞 \${counter::global::a\\nb} 뒤');
      const boundedPlan = counters.prepareCounterVariablePlan(Array.from(
        { length: counters.MAX_COUNTER_VARIABLES_PER_RENDER + 2 },
        (_, index) => '\${counter::global::limit-' + index + '}'
      ).join(','), { createSentinel: sentinelFactory });
      let cimeNicknameIdentity = 'accepted';
      try {
        counters.qualifyCounterUserSubject('cime', 'cime:nickname:abc123');
      } catch (error) {
        cimeNicknameIdentity = error.message;
      }

      console.log(JSON.stringify({
        normalized,
        plan,
        resolved,
        calls,
        removed,
        removedCalls,
        injected,
        injectionCalls,
        failed: {
          ...failed,
          errors: failed.errors.map(({ scope, name, subject, error }) => ({ scope, name, subject, message: error.message })),
        },
        unknown: {
          ...unknown,
          errors: unknown.errors.map(({ scope, name, subject, error }) => ({ scope, name, subject, message: error.message })),
        },
        unknownCalls,
        identities,
        malformedPlan,
        nestedMalformedPlan,
        multilineMalformedPlan,
        boundedPlan,
        cimeNicknameIdentity,
        randomSentinels: [firstRandomPlan.entries[0].sentinel, secondRandomPlan.entries[0].sentinel],
      }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());
  });

  test('normalizes names with NFKC and collapsed whitespace, enforcing the 64-codepoint allowlist', () => {
    expect(result.normalized).toMatchObject({
      nfkc: 'Abc 승 리',
      korean: '출석.연속-합계_1',
      invalidSlash: null,
      invalidColon: null,
      tooLong: null,
    });
    expect(result.normalized.exactLimit).toHaveLength(64);
  });

  test('plans trusted tokens by normalized scope and name and strips invalid counter syntax', () => {
    expect(result.plan.used).toBe(true);
    expect(result.plan.entries).toEqual([
      { scope: 'user', name: '승 리', sentinel: '<<COUNTER:0>>' },
      { scope: 'user', name: '승리', sentinel: '<<COUNTER:1>>' },
      { scope: 'global', name: '승리', sentinel: '<<COUNTER:2>>' },
    ]);
    expect(result.plan.text).not.toMatch(/\$\{\s*counter/iu);
    expect(result.plan.text).not.toContain('무시');
    expect(result.plan.text).not.toContain('잘못/이름');
  });

  test('increments every distinct planned counter once and displays its returned value everywhere', () => {
    expect(result.calls).toEqual([
      { scope: 'user', name: '승 리', subject: 'youtube:viewer-1' },
      { scope: 'user', name: '승리', subject: 'youtube:viewer-1' },
      { scope: 'global', name: '승리', subject: null },
    ]);
    expect(result.resolved.text).toBe('A 7 B 7 C 101 D   E 101');
    expect(result.resolved.resolved.map((entry) => entry.value)).toEqual(['7', '7', '101']);
    expect(result.resolved.errors).toEqual([]);
  });

  test('does not increment a planned token removed by an intervening renderer', () => {
    expect(result.removed.attempted).toBe(1);
    expect(result.removedCalls).toEqual([
      { scope: 'user', name: '남은값', subject: 'chzzk:viewer-2' },
    ]);
    expect(result.removed.text).toBe('3 ');
  });

  test('never promotes a counter token injected by later user placeholder substitution', () => {
    expect(result.injectionCalls).toEqual([
      { scope: 'global', name: 'safe', subject: null },
    ]);
    expect(result.injected.text).toBe('정상 9 닉네임=');
    expect(result.injected.text).not.toMatch(/counter::/u);
  });

  test('strips malformed nested-brace counter text instead of leaking it to chat', () => {
    expect(result.malformedPlan.used).toBe(false);
    expect(result.malformedPlan.text).toBe('앞  뒤');
    expect(result.nestedMalformedPlan.used).toBe(false);
    expect(result.nestedMalformedPlan.text).toBe('앞  뒤');
    expect(result.multilineMalformedPlan.used).toBe(false);
    expect(result.multilineMalformedPlan.text).toBe('앞  뒤');
  });

  test('allows a global-only counter without provider or user identity context', () => {
    expect(result.injected.errors).toEqual([]);
    expect(result.injected.resolved).toEqual([
      { scope: 'global', name: 'safe', subject: null, value: '9' },
    ]);
  });

  test('isolates database and invalid-result failures and displays a Korean fallback', () => {
    expect(result.failed.text).toBe('42/확인 불가/확인 불가');
    expect(result.failed.resolved).toEqual([
      { scope: 'global', name: '정상', subject: null, value: '42' },
    ]);
    expect(result.failed.errors).toEqual([
      { scope: 'user', name: 'DB오류', subject: 'cime:1033927', message: 'temporary database failure' },
      { scope: 'global', name: '잘못된결과', subject: null, message: 'counter_increment_result_invalid' },
    ]);
  });

  test('rejects an unknown per-user identity without blocking a global counter in the same response', () => {
    expect(result.unknown.text).toBe('확인 불가/5');
    expect(result.unknownCalls).toEqual([
      { scope: 'global', name: '전체', subject: null },
    ]);
    expect(result.unknown.errors).toHaveLength(1);
    expect(result.unknown.errors[0]).toMatchObject({
      scope: 'user',
      name: '개인',
      message: 'counter_user_identity_required',
    });
  });

  test('rejects nickname-derived CIME identities for per-user counters', () => {
    expect(result.cimeNicknameIdentity).toBe('counter_user_identity_unstable');
  });

  test('qualifies user subjects once and rejects missing, unknown, or cross-provider identities', () => {
    expect(result.identities).toEqual({
      plain: 'youtube:viewer',
      qualified: 'youtube:viewer',
      ownerQualified: 'youtube:viewer',
      duplicate: 'youtube:viewer',
      missing: 'counter_user_identity_required',
      unknown: 'counter_user_identity_required',
      mismatch: 'counter_user_provider_mismatch',
      nestedMismatch: 'counter_user_provider_mismatch',
      provider: 'counter_user_provider_required',
    });
  });

  test('uses unpredictable production sentinels for separate plans', () => {
    expect(result.randomSentinels[0]).toMatch(/^\uE000ARUBOT_COUNTER:/u);
    expect(result.randomSentinels[0]).not.toBe(result.randomSentinels[1]);
    expect(result.randomSentinels[0]).not.toMatch(/\$\{\s*counter/iu);
  });

  test('bounds distinct counters per render to protect the database hot path', () => {
    expect(result.boundedPlan.entries).toHaveLength(16);
    expect(result.boundedPlan.text).not.toContain('limit-16');
    expect(result.boundedPlan.text).not.toContain('limit-17');
  });
});
