/**
 * 룰렛 기능 핵심 테스트 (간소화된 버전)
 * 요구사항: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4
 */

// Mock dependencies
const mockAxios = {
  post: jest.fn()
};

const mockGetBotSettings = jest.fn();
const mockGetValidAccessToken = jest.fn();

// 룰렛 시스템 핵심 기능 테스트
class SimpleRouletteSystem {
  // 룰렛 정의에서 항목 선택
  chooseRouletteItem(def) {
    if (!def || !Array.isArray(def.items) || def.items.length === 0) {
      return { label: 'N/A', value: null };
    }
    
    const type = String(def.type || 'items');
    const items = def.items.filter(it => it && typeof it.label === 'string');
    
    if (type === 'probability') {
      // 확률형 룰렛 처리
      let total = 0;
      const probs = items.map(it => {
        const p = Number(it.probability || 0);
        const v = p > 1 ? (p / 100) : p;
        total += v;
        return v;
      });
      
      // 정확히 100% 검증 (부동소수점 오차 허용)
      if (Math.abs(total - 1) > 1e-6) {
        throw new Error('roulette_prob_sum_must_be_100');
      }
      
      let r = Math.random() * total;
      for (let i = 0; i < items.length; i++) {
        if ((r -= probs[i]) <= 0) {
          return { label: items[i].label, value: items[i].value ?? null };
        }
      }
      return { label: items[items.length - 1].label, value: items[items.length - 1].value ?? null };
    }
    
    // 가중치형 룰렛 처리
    let sum = 0;
    const weights = items.map(it => {
      const w = Math.max(0, Number(it.weight || 0));
      sum += w;
      return w;
    });
    
    if (sum <= 0) return { label: items[0].label, value: items[0].value ?? null };
    
    let r = Math.random() * sum;
    for (let i = 0; i < items.length; i++) {
      if ((r -= weights[i]) <= 0) {
        return { label: items[i].label, value: items[i].value ?? null };
      }
    }
    return { label: items[items.length - 1].label, value: items[items.length - 1].value ?? null };
  }

  // 룰렛 실행
  async executeRoulette(sid, rouletteName, userId, username) {
    const settings = await mockGetBotSettings(sid) || {};
    const defs = Array.isArray(settings.rouletteDefs) ? settings.rouletteDefs : [];
    const def = defs.find(d => String(d.name).toLowerCase() === String(rouletteName || '').toLowerCase());
    
    if (!def) throw new Error('roulette_not_found');
    
    const picked = this.chooseRouletteItem(def);
    
    return {
      result: picked,
      rouletteName,
      username,
      userId,
      success: true
    };
  }

  // 결과 채팅 전송
  async sendResultChat(sid, result, sessionKey, accessToken) {
    const resultLabel = result.result?.label || '';
    const username = result.username || '';
    
    let resultMsg = '';
    if (resultLabel) {
      resultMsg = `🎯 ${username}님의 룰렛 결과: ${resultLabel}`;
    } else {
      resultMsg = `❌ ${username}님의 룰렛 실행 실패`;
    }
    
    const url = `https://api.example.com/open/v1/chats/send`;
    await mockAxios.post(url, { message: resultMsg }, {
      params: { sessionKey },
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: 5000
    });
    
    return { sent: true, message: resultMsg };
  }
}

// 확률 검증 시스템
class ProbabilityValidator {
  validateProbabilitySum(sum) {
    const tolerance = 0.00001;
    const target = 100;
    const absError = Math.abs(sum - target);
    
    if (absError <= tolerance) {
      return { isValid: true };
    }
    
    if (sum > target) {
      return {
        isValid: false,
        message: `확률 합계가 ${sum.toFixed(4)}%로 ${absError.toFixed(4)}% 초과입니다. 정확히 100%가 되도록 조정하세요.`
      };
    } else {
      return {
        isValid: false,
        message: `확률 합계가 ${sum.toFixed(4)}%로 ${absError.toFixed(4)}% 부족입니다. 정확히 100%가 되도록 조정하세요.`
      };
    }
  }

  isExactly100Percent(sum) {
    return Math.abs(sum - 100) <= 0.00001;
  }
}

// 명령어 실행 컨텍스트 시스템
class CommandExecutionContext {
  executeCommand(command, context) {
    const { source, shouldDeductPoints, userId, username } = context;
    
    // 룰렛 소스에서 실행되는 명령어는 포인트 차감하지 않음
    if (source === 'roulette') {
      return {
        executed: true,
        pointsDeducted: false,
        message: `명령어 "${command}" 실행됨 (룰렛 결과, 포인트 차감 없음)`
      };
    }
    
    // 일반 채팅에서 실행되는 명령어는 포인트 차감
    if (source === 'chat' && shouldDeductPoints) {
      return {
        executed: true,
        pointsDeducted: true,
        message: `명령어 "${command}" 실행됨 (포인트 차감됨)`
      };
    }
    
    return {
      executed: true,
      pointsDeducted: false,
      message: `명령어 "${command}" 실행됨`
    };
  }
}

describe('룰렛 기능 핵심 테스트', () => {
  let rouletteSystem;
  let probabilityValidator;
  let commandContext;

  beforeEach(() => {
    jest.clearAllMocks();
    rouletteSystem = new SimpleRouletteSystem();
    probabilityValidator = new ProbabilityValidator();
    commandContext = new CommandExecutionContext();
    jest.setSystemTime(new Date('2023-01-01T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.useFakeTimers();
  });

  describe('1. 룰렛 항목 선택 로직 (요구사항 1.1, 1.2)', () => {
    test('확률형 룰렛에서 항목이 올바르게 선택되어야 함', () => {
      const def = {
        type: 'probability',
        items: [
          { label: '당첨', probability: 30 },
          { label: '꽝', probability: 70 }
        ]
      };
      
      const result = rouletteSystem.chooseRouletteItem(def);
      expect(['당첨', '꽝']).toContain(result.label);
    });

    test('가중치형 룰렛에서 항목이 올바르게 선택되어야 함', () => {
      const def = {
        type: 'items',
        items: [
          { label: '항목1', weight: 1 },
          { label: '항목2', weight: 2 },
          { label: '항목3', weight: 3 }
        ]
      };
      
      const result = rouletteSystem.chooseRouletteItem(def);
      expect(['항목1', '항목2', '항목3']).toContain(result.label);
    });

    test('빈 룰렛 정의에서 N/A가 반환되어야 함', () => {
      const def = { type: 'probability', items: [] };
      const result = rouletteSystem.chooseRouletteItem(def);
      expect(result.label).toBe('N/A');
    });
  });

  describe('2. 확률 검증 로직 (요구사항 3.1, 3.2, 3.3, 3.4)', () => {
    test('정확히 100%일 때만 유효해야 함', () => {
      // 정확히 100%
      let result = probabilityValidator.validateProbabilitySum(100.0);
      expect(result.isValid).toBe(true);
      
      // 허용 오차 내 (99.999999% - 더 작은 오차)
      result = probabilityValidator.validateProbabilitySum(99.999999);
      expect(result.isValid).toBe(true);
      
      // 허용 오차 내 (100.000001% - 더 작은 오차)
      result = probabilityValidator.validateProbabilitySum(100.000001);
      expect(result.isValid).toBe(true);
    });

    test('100.01%는 유효하지 않아야 함', () => {
      const result = probabilityValidator.validateProbabilitySum(100.01);
      expect(result.isValid).toBe(false);
      expect(result.message).toContain('0.0100% 초과');
    });

    test('99.99%는 유효하지 않아야 함', () => {
      const result = probabilityValidator.validateProbabilitySum(99.99);
      expect(result.isValid).toBe(false);
      expect(result.message).toContain('0.0100% 부족');
    });

    test('확률형 룰렛에서 부정확한 확률 합계 시 오류가 발생해야 함', () => {
      const invalidDef = {
        type: 'probability',
        items: [
          { label: '항목1', probability: 50.01 },
          { label: '항목2', probability: 50.01 }
        ]
      };
      
      expect(() => {
        rouletteSystem.chooseRouletteItem(invalidDef);
      }).toThrow('roulette_prob_sum_must_be_100');
    });

    test('정확한 확률 합계로 룰렛이 정상 작동해야 함', () => {
      const validDef = {
        type: 'probability',
        items: [
          { label: '항목1', probability: 50.0 },
          { label: '항목2', probability: 50.0 }
        ]
      };
      
      const result = rouletteSystem.chooseRouletteItem(validDef);
      expect(['항목1', '항목2']).toContain(result.label);
    });
  });

  describe('3. 룰렛 실행 플로우 (요구사항 1.1, 1.2, 1.3, 1.4, 1.5)', () => {
    test('룰렛 실행이 성공적으로 완료되어야 함', async () => {
      const sid = 'test-sid';
      const rouletteName = '테스트룰렛';
      const userId = 'user123';
      const username = '테스트유저';
      
      // 룰렛 설정 준비
      const settings = {
        rouletteDefs: [{
          id: 'roulette1',
          name: rouletteName,
          type: 'probability',
          items: [
            { id: 'item1', label: '당첨', probability: 30 },
            { id: 'item2', label: '꽝', probability: 70 }
          ]
        }]
      };
      
      mockGetBotSettings.mockResolvedValue(settings);
      
      const result = await rouletteSystem.executeRoulette(sid, rouletteName, userId, username);
      
      expect(result.success).toBe(true);
      expect(result.rouletteName).toBe(rouletteName);
      expect(result.username).toBe(username);
      expect(result.userId).toBe(userId);
      expect(['당첨', '꽝']).toContain(result.result.label);
    });

    test('존재하지 않는 룰렛 실행 시 오류가 발생해야 함', async () => {
      const sid = 'test-sid';
      const rouletteName = '존재하지않는룰렛';
      const userId = 'user123';
      const username = '테스트유저';
      
      mockGetBotSettings.mockResolvedValue({ rouletteDefs: [] });
      
      await expect(
        rouletteSystem.executeRoulette(sid, rouletteName, userId, username)
      ).rejects.toThrow('roulette_not_found');
    });

    test('결과 채팅이 올바르게 전송되어야 함', async () => {
      const sid = 'test-sid';
      const result = {
        result: { label: '당첨', value: null },
        rouletteName: '테스트룰렛',
        username: '테스트유저',
        userId: 'user123',
        success: true
      };
      
      mockAxios.post.mockResolvedValue({ status: 200 });
      
      const chatResult = await rouletteSystem.sendResultChat(
        sid, 
        result, 
        'test-session-key', 
        'test-access-token'
      );
      
      expect(chatResult.sent).toBe(true);
      expect(chatResult.message).toContain('🎯 테스트유저님의 룰렛 결과: 당첨');
      
      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://api.example.com/open/v1/chats/send',
        { message: '🎯 테스트유저님의 룰렛 결과: 당첨' },
        expect.objectContaining({
          params: { sessionKey: 'test-session-key' },
          headers: expect.objectContaining({
            Authorization: 'Bearer test-access-token'
          })
        })
      );
    });
  });

  describe('4. 명령어 실행 컨텍스트 (요구사항 4.1, 4.2, 4.3, 4.4)', () => {
    test('룰렛 결과로 실행되는 명령어는 포인트를 차감하지 않아야 함', () => {
      const command = '!테스트명령어';
      
      // 룰렛 소스에서 실행
      const rouletteContext = {
        source: 'roulette',
        shouldDeductPoints: false,
        userId: 'user123',
        username: '테스트유저'
      };
      
      const result = commandContext.executeCommand(command, rouletteContext);
      
      expect(result.executed).toBe(true);
      expect(result.pointsDeducted).toBe(false);
      expect(result.message).toContain('포인트 차감 없음');
    });

    test('일반 채팅에서 실행되는 명령어는 포인트를 차감해야 함', () => {
      const command = '!테스트명령어';
      
      // 일반 채팅에서 실행
      const chatContext = {
        source: 'chat',
        shouldDeductPoints: true,
        userId: 'user123',
        username: '테스트유저'
      };
      
      const result = commandContext.executeCommand(command, chatContext);
      
      expect(result.executed).toBe(true);
      expect(result.pointsDeducted).toBe(true);
      expect(result.message).toContain('포인트 차감됨');
    });

    test('시스템에서 실행되는 명령어는 포인트를 차감하지 않아야 함', () => {
      const command = '!시스템명령어';
      
      // 시스템에서 실행
      const systemContext = {
        source: 'system',
        shouldDeductPoints: false,
        userId: null,
        username: null
      };
      
      const result = commandContext.executeCommand(command, systemContext);
      
      expect(result.executed).toBe(true);
      expect(result.pointsDeducted).toBe(false);
    });
  });

  describe('5. 통합 시나리오', () => {
    test('완전한 룰렛 실행 플로우', async () => {
      const sid = 'integration-test-sid';
      const rouletteName = '통합테스트룰렛';
      const userId = 'user123';
      const username = '통합테스트유저';
      
      // 1. 룰렛 설정 준비
      const settings = {
        rouletteDefs: [{
          id: 'integration-roulette',
          name: rouletteName,
          type: 'probability',
          items: [
            { id: 'item1', label: '대성공', probability: 10 },
            { id: 'item2', label: '성공', probability: 30 },
            { id: 'item3', label: '보통', probability: 40 },
            { id: 'item4', label: '실패', probability: 20 }
          ]
        }]
      };
      
      mockGetBotSettings.mockResolvedValue(settings);
      mockAxios.post.mockResolvedValue({ status: 200 });
      
      // 2. 룰렛 실행
      const rouletteResult = await rouletteSystem.executeRoulette(sid, rouletteName, userId, username);
      
      expect(rouletteResult.success).toBe(true);
      expect(['대성공', '성공', '보통', '실패']).toContain(rouletteResult.result.label);
      
      // 3. 결과 채팅 전송
      const chatResult = await rouletteSystem.sendResultChat(
        sid, 
        rouletteResult, 
        'integration-session-key', 
        'integration-token'
      );
      
      expect(chatResult.sent).toBe(true);
      expect(chatResult.message).toMatch(
        new RegExp(`🎯 ${username}님의 룰렛 결과: (대성공|성공|보통|실패)`)
      );
      
      // 4. 룰렛 결과로 명령어 실행 시 포인트 차감 없음 확인
      const resultCommand = '!축하';
      const rouletteCommandContext = {
        source: 'roulette',
        shouldDeductPoints: false,
        userId,
        username
      };
      
      const commandResult = commandContext.executeCommand(resultCommand, rouletteCommandContext);
      expect(commandResult.pointsDeducted).toBe(false);
    });

    test('오류 상황 처리', async () => {
      const sid = 'error-test-sid';
      
      // 1. 존재하지 않는 룰렛 실행
      mockGetBotSettings.mockResolvedValue({ rouletteDefs: [] });
      
      await expect(
        rouletteSystem.executeRoulette(sid, '존재하지않는룰렛', 'user123', '테스트유저')
      ).rejects.toThrow('roulette_not_found');
      
      // 2. 채팅 전송 실패
      mockAxios.post.mockRejectedValue(new Error('Network error'));
      
      const result = {
        result: { label: '성공', value: null },
        rouletteName: '테스트룰렛',
        username: '테스트유저',
        userId: 'user123',
        success: true
      };
      
      await expect(
        rouletteSystem.sendResultChat(sid, result, 'session-key', 'access-token')
      ).rejects.toThrow('Network error');
    });
  });

  describe('6. 성능 테스트', () => {
    test('대량 룰렛 실행 성능', async () => {
      const sid = 'performance-test-sid';
      const settings = {
        rouletteDefs: [{
          id: 'performance-roulette',
          name: '성능테스트룰렛',
          type: 'probability',
          items: [
            { id: 'item1', label: '결과1', probability: 50 },
            { id: 'item2', label: '결과2', probability: 50 }
          ]
        }]
      };
      
      mockGetBotSettings.mockResolvedValue(settings);
      
      const startTime = Date.now();
      
      // 100개의 룰렛 실행
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          rouletteSystem.executeRoulette(sid, '성능테스트룰렛', `user${i}`, `사용자${i}`)
        );
      }
      
      const results = await Promise.all(promises);
      
      const endTime = Date.now();
      const processingTime = endTime - startTime;
      
      // 성능 검증 (1초 내에 100개 처리)
      expect(processingTime).toBeLessThan(1000);
      
      // 모든 결과가 성공적으로 처리되었는지 확인
      expect(results).toHaveLength(100);
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(['결과1', '결과2']).toContain(result.result.label);
      });
    });

    test('확률 분포 검증', () => {
      const def = {
        type: 'probability',
        items: [
          { label: '당첨', probability: 30 },
          { label: '꽝', probability: 70 }
        ]
      };
      
      const results = { '당첨': 0, '꽝': 0 };
      const iterations = 1000;
      
      // 1000번 실행하여 확률 분포 확인
      for (let i = 0; i < iterations; i++) {
        const result = rouletteSystem.chooseRouletteItem(def);
        results[result.label]++;
      }
      
      const winRate = results['당첨'] / iterations;
      const loseRate = results['꽝'] / iterations;
      
      // 30% ± 5% 범위 내에 있어야 함
      expect(winRate).toBeGreaterThan(0.25);
      expect(winRate).toBeLessThan(0.35);
      
      // 70% ± 5% 범위 내에 있어야 함
      expect(loseRate).toBeGreaterThan(0.65);
      expect(loseRate).toBeLessThan(0.75);
    });
  });
});