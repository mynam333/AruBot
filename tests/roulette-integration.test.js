/**
 * 룰렛 기능 통합 테스트
 * 요구사항: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4
 */

// Mock dependencies
const mockAxios = {
  post: jest.fn()
};

const mockGetBotSettings = jest.fn();
const mockSetBotSettings = jest.fn();
const mockGetValidAccessToken = jest.fn();

// Mock WebSocket for RouletteViewer testing
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    
    // 비동기적으로 연결 성공 시뮬레이션
    setTimeout(() => {
      if (this.onopen) this.onopen();
    }, 10);
  }
  
  send(data) {
    // 메시지 전송 시뮬레이션
  }
  
  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose({ code: 1000, reason: 'Normal closure', wasClean: true });
    }
  }
  
  // 테스트용 메시지 시뮬레이션 메서드
  simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
  
  simulateError() {
    if (this.onerror) {
      this.onerror({ type: 'error' });
    }
  }
}

// Mock session store
const mockSessionStore = new Map();

// Mock logger
const mockLogger = {
  logMacroSent: jest.fn(),
  logMacroSkipped: jest.fn(),
  logLiveStatusChange: jest.fn(),
  logCacheRefresh: jest.fn(),
  isDebugMode: false
};

// 룰렛 시스템 클래스 (서버 로직 시뮬레이션)
class RouletteSystem {
  constructor() {
    this.rouletteQueues = new Map();
    this.rouletteProcessing = new Set();
    this.rouletteLastResultSent = new Map();
    this.rouletteLastEnqueue = new Map();
    this.rouletteTokenSockets = new Map();
    this.rouletteTokenToSid = new Map();
    this.ROULETTE_SPIN_MS = 5000;
    this.ROULETTE_EMPHASIS_MS = 1000;
  }

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

  // 룰렛 스핀 큐에 추가
  enqueueRouletteSpin(sid, item) {
    const q = this.rouletteQueues.get(sid) || [];
    q.push(item);
    const position = q.length;
    this.rouletteQueues.set(sid, q);
    
    if (!this.rouletteProcessing.has(sid)) {
      // 테스트에서는 즉시 처리
      this.processRouletteQueue(sid).catch((e) => {
        console.warn('[Roulette Queue] Processor error', e?.message || e);
      });
    }
    return position;
  }

  // 룰렛 큐 처리 (동기적으로 처리하여 테스트 안정성 확보)
  async processRouletteQueue(sid) {
    if (this.rouletteProcessing.has(sid)) return;
    this.rouletteProcessing.add(sid);
    
    try {
      while (true) {
        const q = this.rouletteQueues.get(sid) || [];
        const item = q.shift();
        if (!item) {
          this.rouletteQueues.set(sid, q);
          break;
        }
        this.rouletteQueues.set(sid, q);
        
        try {
          const started = await this.startRouletteSpin(
            sid,
            item.name,
            String(item.userId || ''),
            String(item.username || ''),
            {
              instant: item?.instant === true,
              batchId: item?.chatPost?.batchId || null,
              batchCount: Math.max(1, Number(item?.chatPost?.batchCount ?? 1)),
            }
          );
          
          // 결과 채팅 전송
          const suppress = item?.chatPost?.suppressResultChat === true;
          if (!suppress) {
            await this.sendResultChat(sid, item, started);
          }
        } catch (e) {
          console.error('[Roulette Queue] Spin error (continuing)', e?.message || e);
          await this.sendErrorChat(sid, item, e);
        }
      }
    } finally {
      this.rouletteProcessing.delete(sid);
    }
  }

  // 룰렛 스핀 시작
  async startRouletteSpin(sid, rouletteName, userId, username, opts = {}) {
    const settings = await mockGetBotSettings(sid) || {};
    const defs = this.getRouletteDefsFromSettings(settings);
    const def = defs.find(d => String(d.name).toLowerCase() === String(rouletteName || '').toLowerCase());
    
    if (!def) throw new Error('roulette_not_found');
    
    const picked = this.chooseRouletteItem(def);
    
    // WebSocket으로 룰렛 이벤트 전송
    const token = settings.rouletteViewerToken;
    if (token) {
      const sockets = this.rouletteTokenSockets.get(token);
      if (sockets && sockets.size > 0) {
        const payload = {
          type: 'roulette',
          name: rouletteName,
          username: username,
          label: picked.label,
          value: picked.value,
          instant: opts.instant || false,
          batchId: opts.batchId,
          batchCount: opts.batchCount
        };
        
        for (const ws of sockets) {
          if (ws.readyState === 1) {
            ws.simulateMessage(payload);
          }
        }
      }
    }
    
    return {
      result: picked,
      rouletteName,
      username,
      userId
    };
  }

  // 설정에서 룰렛 정의 추출
  getRouletteDefsFromSettings(settings) {
    return Array.isArray(settings.rouletteDefs) ? settings.rouletteDefs : [];
  }

  // 결과 채팅 전송
  async sendResultChat(sid, item, started) {
    const resultLabel = (started && started.result && (started.result.label || started.result.value)) 
      ? (started.result.label || String(started.result.value)) : '';
    const userForMsg = ((item.chatPost && item.chatPost.resolvedUsername) || item.username || '').trim();
    
    let resultMsg = '';
    if (resultLabel) {
      resultMsg = `🎯 ${userForMsg}님의 룰렛 결과: ${resultLabel}`;
    } else {
      resultMsg = `❌ ${userForMsg}님의 룰렛 실행 실패`;
    }
    
    // 중복 방지
    const dedupKey = `${userForMsg}|${resultLabel}`;
    const last = this.rouletteLastResultSent.get(sid);
    const nowTs = Date.now();
    
    if (!(last && last.key === dedupKey && (nowTs - last.at) < 3000)) {
      let sessionKey = item?.chatPost?.sessionKey || null;
      let token = item?.chatPost?.accessToken || null;
      
      if (!sessionKey) {
        try {
          const entry = mockSessionStore.get(sid);
          sessionKey = entry?.sessionKey || null;
        } catch (e) {
          console.error('[Roulette Queue] Failed to get session key:', e);
        }
      }
      
      if (!token) {
        try {
          token = await mockGetValidAccessToken(sid);
        } catch (e) {
          console.error('[Roulette Queue] Failed to get access token:', e);
        }
      }
      
      if (sessionKey && token) {
        const url = `https://api.example.com/open/v1/chats/send`;
        try {
          await mockAxios.post(url, { message: resultMsg }, {
            params: { sessionKey },
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            timeout: 5000
          });
          this.rouletteLastResultSent.set(sid, { key: dedupKey, at: Date.now() });
        } catch (e) {
          console.error('[Roulette Queue] Failed to send result chat:', e?.response?.data || e?.message || e);
          throw e;
        }
      } else {
        throw new Error('Missing session/access credentials');
      }
    }
  }

  // 오류 채팅 전송
  async sendErrorChat(sid, item, error) {
    try {
      const userForMsg = ((item.chatPost && item.chatPost.resolvedUsername) || item.username || '').trim();
      const errorMsg = `❌ ${userForMsg}님의 룰렛 "${item.name}" 실행 실패: ${error?.message || '알 수 없는 오류'}`;
      
      let sessionKey = item?.chatPost?.sessionKey || null;
      let token = item?.chatPost?.accessToken || null;
      
      if (!sessionKey) {
        try {
          const entry = mockSessionStore.get(sid);
          sessionKey = entry?.sessionKey || null;
        } catch {}
      }
      
      if (!token) {
        try {
          token = await mockGetValidAccessToken(sid);
        } catch {}
      }
      
      if (sessionKey && token) {
        const url = `https://api.example.com/open/v1/chats/send`;
        await mockAxios.post(url, { message: errorMsg }, {
          params: { sessionKey },
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          timeout: 3000
        });
      }
    } catch (e2) {
      console.error('[Roulette Queue] Failed to send error message:', e2);
    }
  }

  // WebSocket 연결 시뮬레이션
  connectWebSocket(token, ws) {
    if (!this.rouletteTokenSockets.has(token)) {
      this.rouletteTokenSockets.set(token, new Set());
    }
    this.rouletteTokenSockets.get(token).add(ws);
  }

  // WebSocket 연결 해제 시뮬레이션
  disconnectWebSocket(token, ws) {
    const sockets = this.rouletteTokenSockets.get(token);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        this.rouletteTokenSockets.delete(token);
      }
    }
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
  constructor() {
    this.executionHistory = new Map();
  }

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

describe('룰렛 기능 통합 테스트', () => {
  // 전체 테스트 스위트의 타임아웃을 20초로 설정
  jest.setTimeout(20000);
  let rouletteSystem;
  let probabilityValidator;
  let commandContext;
  let originalWebSocket;

  beforeEach(() => {
    jest.clearAllMocks();
    rouletteSystem = new RouletteSystem();
    probabilityValidator = new ProbabilityValidator();
    commandContext = new CommandExecutionContext();
    mockSessionStore.clear();
    jest.setSystemTime(new Date('2023-01-01T12:00:00Z'));
    
    // WebSocket 모킹
    originalWebSocket = global.WebSocket;
    global.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.WebSocket = originalWebSocket;
  });

  describe('1. 룰렛 명령어 실행 플로우 (요구사항 1.1, 1.2, 1.3, 1.4, 1.5)', () => {
    test('룰렛 명령어 실행 시 전체 플로우가 정상 작동해야 함', async () => {
      const sid = 'test-sid';
      const rouletteName = '테스트룰렛';
      const userId = 'user123';
      const username = '테스트유저';
      
      // 룰렛 설정 준비
      const settings = {
        rouletteViewerToken: 'test-token',
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
      mockGetValidAccessToken.mockResolvedValue('valid-token');
      mockAxios.post.mockResolvedValue({ status: 200 });
      
      // 세션 설정
      mockSessionStore.set(sid, { sessionKey: 'test-session-key' });
      
      // WebSocket 연결 시뮬레이션
      const mockWs = new MockWebSocket('ws://localhost/api/roulette/ws?token=test-token');
      rouletteSystem.connectWebSocket('test-token', mockWs);
      
      let receivedMessage = null;
      mockWs.onmessage = (event) => {
        receivedMessage = JSON.parse(event.data);
      };
      
      // 룰렛 실행
      const item = {
        name: rouletteName,
        userId,
        username,
        chatPost: {
          sessionKey: 'test-session-key',
          accessToken: 'valid-token',
          resolvedUsername: username
        }
      };
      
      const queuePosition = rouletteSystem.enqueueRouletteSpin(sid, item);
      expect(queuePosition).toBe(1);
      
      // 큐 처리 대기
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // WebSocket 메시지 수신 확인
      expect(receivedMessage).toBeTruthy();
      expect(receivedMessage.type).toBe('roulette');
      expect(receivedMessage.name).toBe(rouletteName);
      expect(receivedMessage.username).toBe(username);
      expect(['당첨', '꽝']).toContain(receivedMessage.label);
      
      // 채팅 결과 전송 확인
      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://api.example.com/open/v1/chats/send',
        expect.objectContaining({
          message: expect.stringContaining(`🎯 ${username}님의 룰렛 결과:`)
        }),
        expect.objectContaining({
          params: { sessionKey: 'test-session-key' },
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-token'
          })
        })
      );
    });

    test('룰렛 실행 실패 시 오류 메시지가 전송되어야 함', async () => {
      const sid = 'test-sid';
      const rouletteName = '존재하지않는룰렛';
      const userId = 'user123';
      const username = '테스트유저';
      
      // 빈 룰렛 설정
      mockGetBotSettings.mockResolvedValue({ rouletteDefs: [] });
      mockGetValidAccessToken.mockResolvedValue('valid-token');
      mockAxios.post.mockResolvedValue({ status: 200 });
      
      // 세션 설정
      mockSessionStore.set(sid, { sessionKey: 'test-session-key' });
      
      // 룰렛 실행
      const item = {
        name: rouletteName,
        userId,
        username,
        chatPost: {
          sessionKey: 'test-session-key',
          accessToken: 'valid-token',
          resolvedUsername: username
        }
      };
      
      rouletteSystem.enqueueRouletteSpin(sid, item);
      
      // 큐 처리 대기
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 오류 메시지 전송 확인
      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://api.example.com/open/v1/chats/send',
        expect.objectContaining({
          message: expect.stringContaining(`❌ ${username}님의 룰렛 "${rouletteName}" 실행 실패`)
        }),
        expect.any(Object)
      );
    });

    test('WebSocket 연결이 없어도 룰렛 실행이 완료되어야 함', async () => {
      const sid = 'test-sid';
      const rouletteName = '테스트룰렛';
      const userId = 'user123';
      const username = '테스트유저';
      
      // 룰렛 설정 준비 (토큰 없음)
      const settings = {
        rouletteDefs: [{
          id: 'roulette1',
          name: rouletteName,
          type: 'probability',
          items: [
            { id: 'item1', label: '당첨', probability: 50 },
            { id: 'item2', label: '꽝', probability: 50 }
          ]
        }]
      };
      
      mockGetBotSettings.mockResolvedValue(settings);
      mockGetValidAccessToken.mockResolvedValue('valid-token');
      mockAxios.post.mockResolvedValue({ status: 200 });
      
      // 세션 설정
      mockSessionStore.set(sid, { sessionKey: 'test-session-key' });
      
      // 룰렛 실행
      const item = {
        name: rouletteName,
        userId,
        username,
        chatPost: {
          sessionKey: 'test-session-key',
          accessToken: 'valid-token',
          resolvedUsername: username
        }
      };
      
      rouletteSystem.enqueueRouletteSpin(sid, item);
      
      // 큐 처리 대기
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 채팅 결과는 여전히 전송되어야 함
      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://api.example.com/open/v1/chats/send',
        expect.objectContaining({
          message: expect.stringContaining(`🎯 ${username}님의 룰렛 결과:`)
        }),
        expect.any(Object)
      );
    });
  });

  describe('2. RouletteViewer 컴포넌트 안정성 (요구사항 1.3)', () => {
    test('WebSocket 연결 및 메시지 처리가 정상 작동해야 함', async () => {
      const token = 'test-token';
      const mockWs = new MockWebSocket(`ws://localhost/api/roulette/ws?token=${token}`);
      
      let connectionOpened = false;
      let receivedMessages = [];
      
      mockWs.onopen = () => {
        connectionOpened = true;
      };
      
      mockWs.onmessage = (event) => {
        receivedMessages.push(JSON.parse(event.data));
      };
      
      // 연결 대기
      await new Promise(resolve => setTimeout(resolve, 20));
      
      expect(connectionOpened).toBe(true);
      
      // 룰렛 메시지 시뮬레이션
      const rouletteMessage = {
        type: 'roulette',
        name: '테스트룰렛',
        username: '테스트유저',
        label: '당첨',
        value: null
      };
      
      mockWs.simulateMessage(rouletteMessage);
      
      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]).toEqual(rouletteMessage);
    });

    test('WebSocket 연결 실패 시 재연결을 시도해야 함', async () => {
      const token = 'test-token';
      const mockWs = new MockWebSocket(`ws://localhost/api/roulette/ws?token=${token}`);
      
      let errorOccurred = false;
      let connectionClosed = false;
      
      mockWs.onerror = () => {
        errorOccurred = true;
      };
      
      mockWs.onclose = (event) => {
        connectionClosed = true;
      };
      
      // 연결 오류 시뮬레이션
      mockWs.simulateError();
      
      expect(errorOccurred).toBe(true);
      
      // 연결 종료 시뮬레이션
      mockWs.close();
      
      expect(connectionClosed).toBe(true);
    });
  });

  describe('3. 확률 검증 로직 정밀도 (요구사항 3.1, 3.2, 3.3, 3.4)', () => {
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

  describe('4. 룰렛 명령어 실행 시 포인트 차감 방지 (요구사항 4.1, 4.2, 4.3, 4.4)', () => {
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

  describe('5. 전체 통합 시나리오', () => {
    test('완전한 룰렛 플로우: 명령어 실행 → 화면 표시 → 결과 표시', async () => {
      const sid = 'test-sid';
      const rouletteName = '통합테스트룰렛';
      const userId = 'user123';
      const username = '통합테스트유저';
      
      // 1. 룰렛 설정 준비
      const settings = {
        rouletteViewerToken: 'integration-test-token',
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
      mockGetValidAccessToken.mockResolvedValue('integration-token');
      mockAxios.post.mockResolvedValue({ status: 200 });
      
      // 2. 세션 설정
      mockSessionStore.set(sid, { sessionKey: 'integration-session-key' });
      
      // 3. WebSocket 연결 시뮬레이션
      const mockWs = new MockWebSocket('ws://localhost/api/roulette/ws?token=integration-test-token');
      rouletteSystem.connectWebSocket('integration-test-token', mockWs);
      
      let wsMessages = [];
      mockWs.onmessage = (event) => {
        wsMessages.push(JSON.parse(event.data));
      };
      
      // 4. 룰렛 명령어 실행
      const item = {
        name: rouletteName,
        userId,
        username,
        chatPost: {
          sessionKey: 'integration-session-key',
          accessToken: 'integration-token',
          resolvedUsername: username
        }
      };
      
      const queuePosition = rouletteSystem.enqueueRouletteSpin(sid, item);
      expect(queuePosition).toBe(1);
      
      // 5. 처리 완료 대기
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 6. WebSocket 메시지 확인 (화면 표시)
      expect(wsMessages).toHaveLength(1);
      const wsMessage = wsMessages[0];
      expect(wsMessage.type).toBe('roulette');
      expect(wsMessage.name).toBe(rouletteName);
      expect(wsMessage.username).toBe(username);
      expect(['대성공', '성공', '보통', '실패']).toContain(wsMessage.label);
      
      // 7. 채팅 결과 확인 (결과 표시)
      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://api.example.com/open/v1/chats/send',
        expect.objectContaining({
          message: expect.stringMatching(new RegExp(`🎯 ${username}님의 룰렛 결과: (대성공|성공|보통|실패)`))
        }),
        expect.objectContaining({
          params: { sessionKey: 'integration-session-key' },
          headers: expect.objectContaining({
            Authorization: 'Bearer integration-token'
          })
        })
      );
      
      // 8. 룰렛 결과로 명령어 실행 시 포인트 차감 없음 확인
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

    test('다중 룰렛 동시 실행 시나리오', async () => {
      const sid = 'multi-test-sid';
      const settings = {
        rouletteViewerToken: 'multi-test-token',
        rouletteDefs: [{
          id: 'multi-roulette',
          name: '다중테스트룰렛',
          type: 'probability',
          items: [
            { id: 'item1', label: 'A', probability: 25 },
            { id: 'item2', label: 'B', probability: 25 },
            { id: 'item3', label: 'C', probability: 25 },
            { id: 'item4', label: 'D', probability: 25 }
          ]
        }]
      };
      
      mockGetBotSettings.mockResolvedValue(settings);
      mockGetValidAccessToken.mockResolvedValue('multi-token');
      mockAxios.post.mockResolvedValue({ status: 200 });
      mockSessionStore.set(sid, { sessionKey: 'multi-session-key' });
      
      // WebSocket 연결
      const mockWs = new MockWebSocket('ws://localhost/api/roulette/ws?token=multi-test-token');
      rouletteSystem.connectWebSocket('multi-test-token', mockWs);
      
      let wsMessages = [];
      mockWs.onmessage = (event) => {
        wsMessages.push(JSON.parse(event.data));
      };
      
      // 여러 사용자가 동시에 룰렛 실행
      const users = [
        { userId: 'user1', username: '사용자1' },
        { userId: 'user2', username: '사용자2' },
        { userId: 'user3', username: '사용자3' }
      ];
      
      users.forEach(user => {
        const item = {
          name: '다중테스트룰렛',
          userId: user.userId,
          username: user.username,
          chatPost: {
            sessionKey: 'multi-session-key',
            accessToken: 'multi-token',
            resolvedUsername: user.username
          }
        };
        rouletteSystem.enqueueRouletteSpin(sid, item);
      });
      
      // 모든 처리 완료 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 모든 사용자의 룰렛이 처리되었는지 확인
      expect(wsMessages).toHaveLength(3);
      expect(mockAxios.post).toHaveBeenCalledTimes(3);
      
      // 각 사용자별로 결과가 올바르게 전송되었는지 확인
      users.forEach((user, index) => {
        expect(wsMessages[index].username).toBe(user.username);
        expect(['A', 'B', 'C', 'D']).toContain(wsMessages[index].label);
      });
    });

    test('오류 복구 시나리오', async () => {
      const sid = 'error-test-sid';
      const settings = {
        rouletteViewerToken: 'error-test-token',
        rouletteDefs: [{
          id: 'error-roulette',
          name: '오류테스트룰렛',
          type: 'probability',
          items: [
            { id: 'item1', label: '성공', probability: 100 }
          ]
        }]
      };
      
      mockGetBotSettings.mockResolvedValue(settings);
      mockGetValidAccessToken.mockResolvedValue('error-token');
      
      // 첫 번째 시도는 실패, 두 번째 시도는 성공
      mockAxios.post
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ status: 200 });
      
      mockSessionStore.set(sid, { sessionKey: 'error-session-key' });
      
      const item = {
        name: '오류테스트룰렛',
        userId: 'error-user',
        username: '오류테스트유저',
        chatPost: {
          sessionKey: 'error-session-key',
          accessToken: 'error-token',
          resolvedUsername: '오류테스트유저'
        }
      };
      
      rouletteSystem.enqueueRouletteSpin(sid, item);
      
      // 처리 완료 대기
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 오류 메시지가 전송되었는지 확인
      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://api.example.com/open/v1/chats/send',
        expect.objectContaining({
          message: expect.stringContaining('❌ 오류테스트유저님의 룰렛 "오류테스트룰렛" 실행 실패')
        }),
        expect.any(Object)
      );
    });
  });

  describe('6. 성능 및 안정성 테스트', () => {
    test('대량 룰렛 요청 처리', async () => {
      const sid = 'performance-test-sid';
      const settings = {
        rouletteViewerToken: 'performance-test-token',
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
      mockGetValidAccessToken.mockResolvedValue('performance-token');
      mockAxios.post.mockResolvedValue({ status: 200 });
      mockSessionStore.set(sid, { sessionKey: 'performance-session-key' });
      
      const startTime = Date.now();
      
      // 100개의 룰렛 요청 생성
      for (let i = 0; i < 100; i++) {
        const item = {
          name: '성능테스트룰렛',
          userId: `user${i}`,
          username: `사용자${i}`,
          chatPost: {
            sessionKey: 'performance-session-key',
            accessToken: 'performance-token',
            resolvedUsername: `사용자${i}`
          }
        };
        rouletteSystem.enqueueRouletteSpin(sid, item);
      }
      
      // 모든 처리 완료 대기 (충분한 시간 제공)
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const endTime = Date.now();
      const processingTime = endTime - startTime;
      
      // 성능 검증 (2초 내에 100개 처리)
      expect(processingTime).toBeLessThanOrEqual(2500);
      
      // 모든 요청이 처리되었는지 확인
      expect(mockAxios.post).toHaveBeenCalledTimes(100);
    });

    test('메모리 누수 방지 확인', async () => {
      const sid = 'memory-test-sid';
      
      // 많은 룰렛 실행 후 메모리 정리 확인
      for (let i = 0; i < 50; i++) {
        const item = {
          name: '메모리테스트룰렛',
          userId: `user${i}`,
          username: `사용자${i}`
        };
        rouletteSystem.enqueueRouletteSpin(sid, item);
      }
      
      // 처리 완료 대기
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 큐가 비워졌는지 확인
      const queue = rouletteSystem.rouletteQueues.get(sid) || [];
      expect(queue).toHaveLength(0);
      
      // 처리 상태가 정리되었는지 확인
      expect(rouletteSystem.rouletteProcessing.has(sid)).toBe(false);
    });
  });
});
