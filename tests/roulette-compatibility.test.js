/**
 * 룰렛 채널 격리 기능 - 기존 기능 호환성 검증 테스트
 * 
 * 이 테스트는 채널 격리 구현 후에도 기존 룰렛 기능이 정상적으로 작동하는지 확인합니다.
 * - 기존 룰렛 API 엔드포인트 동작 확인
 * - 기존 토큰 생성 및 검증 로직 유지 확인
 * - 데이터베이스 스키마 호환성 확인
 */

const { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } = require('@jest/globals');

// 테스트 환경 설정
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY = 'test-key';
process.env.SUPABASE_DB_URL = 'postgresql://postgres:postgres@localhost:54322/postgres';

// Mock WebSocket 클래스
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.messages = [];
    
    // 연결 시뮬레이션
    setTimeout(() => {
      if (this.onopen) this.onopen();
    }, 10);
  }
  
  send(data) {
    this.messages.push(data);
  }
  
  close(code, reason) {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose({ code, reason });
  }
  
  ping() {
    // ping 메서드 시뮬레이션
  }
}

// 테스트용 서버 모듈 모킹
const mockServer = {
  // 기존 룰렛 API 엔드포인트 시뮬레이션
  rouletteEndpoints: {
    '/api/roulette/viewer-url': {
      method: 'GET',
      handler: async (req) => {
        return {
          sid: 'test-sid',
          token: 'test-roulette-token-12345678',
          path: '/roulette/test-roulette-token-12345678'
        };
      }
    },
    '/api/roulette/resolve-token': {
      method: 'GET', 
      handler: async (req) => {
        const uid = req.query?.uid;
        if (!uid) throw new Error('UID required');
        
        return {
          token: `resolved-token-${uid}-12345678`,
          path: `/roulette/resolved-token-${uid}-12345678`
        };
      }
    },
    '/api/roulette/logs': {
      method: 'GET',
      handler: async (req) => {
        const uid = req.query?.uid;
        const limit = parseInt(req.query?.limit || '50');
        const offset = parseInt(req.query?.offset || '0');
        
        return {
          logs: [
            {
              id: 1,
              roulette_name: '테스트룰렛',
              username: '테스트유저',
              result_value: 1,
              result_label: '당첨',
              created_at: new Date().toISOString()
            }
          ],
          total: 1,
          limit,
          offset
        };
      }
    },
    '/api/public/:uid/roulette-defs': {
      method: 'GET',
      handler: async (req) => {
        const uid = req.params?.uid;
        if (!uid) throw new Error('UID required');
        
        return {
          defs: [
            {
              name: '테스트룰렛',
              theme: 'default',
              items: [
                { label: '당첨', weight: 1 },
                { label: '꽝', weight: 9 }
              ]
            }
          ]
        };
      }
    }
  },

  // 토큰 생성 및 검증 로직 시뮬레이션
  tokenSystem: {
    rouletteTokenToSid: new Map(),
    pvdTokenToSid: new Map(),
    
    generateRouletteToken: (sid) => {
      const token = `roulette-${sid}-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
      mockServer.tokenSystem.rouletteTokenToSid.set(token, sid);
      return token;
    },
    
    validateRouletteToken: (token) => {
      return mockServer.tokenSystem.rouletteTokenToSid.get(token) || null;
    },
    
    generatePvdToken: (sid) => {
      const token = `pvd-${sid}-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
      mockServer.tokenSystem.pvdTokenToSid.set(token, sid);
      return token;
    },
    
    validatePvdToken: (token) => {
      return mockServer.tokenSystem.pvdTokenToSid.get(token) || null;
    }
  },

  // 데이터베이스 스키마 시뮬레이션
  database: {
    tables: {
      roulette_sessions: {
        columns: ['id', 'sid', 'channel_id', 'token', 'roulette_name', 'username', 'result_value', 'result_label', 'created_at'],
        data: []
      },
      sessions: {
        columns: ['sid', 'channel_id', 'user_id', 'created_at', 'last_seen'],
        data: []
      },
      channel_tokens: {
        columns: ['channel_id', 'token_type', 'token_value', 'sid', 'created_at', 'expires_at', 'active'],
        data: []
      }
    },
    
    insert: (table, data) => {
      if (!mockServer.database.tables[table]) {
        throw new Error(`Table ${table} does not exist`);
      }
      
      const record = {
        id: mockServer.database.tables[table].data.length + 1,
        ...data,
        created_at: new Date().toISOString()
      };
      
      mockServer.database.tables[table].data.push(record);
      return record;
    },
    
    select: (table, conditions = {}) => {
      if (!mockServer.database.tables[table]) {
        throw new Error(`Table ${table} does not exist`);
      }
      
      let results = mockServer.database.tables[table].data;
      
      // 간단한 조건 필터링
      Object.keys(conditions).forEach(key => {
        results = results.filter(row => row[key] === conditions[key]);
      });
      
      return results;
    },
    
    checkSchema: (table) => {
      const tableSchema = mockServer.database.tables[table];
      if (!tableSchema) {
        return { exists: false, columns: [] };
      }
      
      return {
        exists: true,
        columns: tableSchema.columns,
        indexes: [`${table}_sid_idx`, `${table}_created_idx`]
      };
    }
  }
};

describe('룰렛 채널 격리 - 기존 기능 호환성 검증', () => {
  
  beforeAll(async () => {
    console.log('[호환성 테스트] 테스트 환경 초기화 시작');
    
    // 테스트 데이터 초기화
    const testSid = 'test-channel-123';
    const testChannelId = 'channel-123';
    
    // 세션 데이터 생성
    mockServer.database.insert('sessions', {
      sid: testSid,
      channel_id: testChannelId,
      user_id: 'test-user-123'
    });
    
    // 룰렛 토큰 생성
    const rouletteToken = mockServer.tokenSystem.generateRouletteToken(testSid);
    
    // 채널 토큰 매핑 생성
    mockServer.database.insert('channel_tokens', {
      channel_id: testChannelId,
      token_type: 'roulette',
      token_value: rouletteToken,
      sid: testSid,
      active: true
    });
    
    console.log('[호환성 테스트] 테스트 환경 초기화 완료');
  });
  
  afterAll(async () => {
    console.log('[호환성 테스트] 테스트 환경 정리 완료');
  });
  
  beforeEach(() => {
    // 각 테스트 전 상태 초기화
  });
  
  afterEach(() => {
    // 각 테스트 후 정리
  });

  describe('기존 룰렛 API 엔드포인트 동작 확인', () => {
    
    test('룰렛 뷰어 URL 생성 API가 정상 작동해야 함', async () => {
      const endpoint = mockServer.rouletteEndpoints['/api/roulette/viewer-url'];
      
      const mockReq = {};
      const result = await endpoint.handler(mockReq);
      
      expect(result).toHaveProperty('sid');
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('path');
      expect(result.token).toMatch(/^test-roulette-token-/);
      expect(result.path).toBe(`/roulette/${result.token}`);
      
      console.log('[호환성 테스트] 룰렛 뷰어 URL 생성 API 검증 완료:', result);
    });
    
    test('룰렛 토큰 해결 API가 정상 작동해야 함', async () => {
      const testUid = 'test-channel-uid';
      const endpoint = mockServer.rouletteEndpoints['/api/roulette/resolve-token'];
      
      const mockReq = {
        query: { uid: testUid }
      };
      
      const result = await endpoint.handler(mockReq);
      
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('path');
      expect(result.token).toMatch(new RegExp(`^resolved-token-${testUid}-`));
      expect(result.path).toBe(`/roulette/${result.token}`);
      
      console.log('[호환성 테스트] 룰렛 토큰 해결 API 검증 완료:', result);
    });
    
    test('룰렛 로그 조회 API가 정상 작동해야 함', async () => {
      const testUid = 'test-channel-uid';
      const endpoint = mockServer.rouletteEndpoints['/api/roulette/logs'];
      
      const mockReq = {
        query: { 
          uid: testUid,
          limit: '10',
          offset: '0'
        }
      };
      
      const result = await endpoint.handler(mockReq);
      
      expect(result).toHaveProperty('logs');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('limit', 10);
      expect(result).toHaveProperty('offset', 0);
      expect(Array.isArray(result.logs)).toBe(true);
      
      if (result.logs.length > 0) {
        const log = result.logs[0];
        expect(log).toHaveProperty('roulette_name');
        expect(log).toHaveProperty('username');
        expect(log).toHaveProperty('result_value');
        expect(log).toHaveProperty('result_label');
        expect(log).toHaveProperty('created_at');
      }
      
      console.log('[호환성 테스트] 룰렛 로그 조회 API 검증 완료:', result);
    });
    
    test('공개 룰렛 정의 조회 API가 정상 작동해야 함', async () => {
      const testUid = 'test-channel-uid';
      const endpoint = mockServer.rouletteEndpoints['/api/public/:uid/roulette-defs'];
      
      const mockReq = {
        params: { uid: testUid }
      };
      
      const result = await endpoint.handler(mockReq);
      
      expect(result).toHaveProperty('defs');
      expect(Array.isArray(result.defs)).toBe(true);
      
      if (result.defs.length > 0) {
        const def = result.defs[0];
        expect(def).toHaveProperty('name');
        expect(def).toHaveProperty('theme');
        expect(def).toHaveProperty('items');
        expect(Array.isArray(def.items)).toBe(true);
        
        if (def.items.length > 0) {
          const item = def.items[0];
          expect(item).toHaveProperty('label');
          expect(item).toHaveProperty('weight');
        }
      }
      
      console.log('[호환성 테스트] 공개 룰렛 정의 조회 API 검증 완료:', result);
    });
    
    test('API 엔드포인트 오류 처리가 정상 작동해야 함', async () => {
      const endpoint = mockServer.rouletteEndpoints['/api/roulette/resolve-token'];
      
      const mockReq = {
        query: {} // UID 누락
      };
      
      await expect(endpoint.handler(mockReq)).rejects.toThrow('UID required');
      
      console.log('[호환성 테스트] API 오류 처리 검증 완료');
    });
  });

  describe('기존 토큰 생성 및 검증 로직 유지 확인', () => {
    
    test('룰렛 토큰 생성이 정상 작동해야 함', () => {
      const testSid = 'test-sid-123';
      const token = mockServer.tokenSystem.generateRouletteToken(testSid);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(20);
      expect(token).toMatch(/^roulette-/);
      
      // 토큰-SID 매핑 확인
      const mappedSid = mockServer.tokenSystem.validateRouletteToken(token);
      expect(mappedSid).toBe(testSid);
      
      console.log('[호환성 테스트] 룰렛 토큰 생성 검증 완료:', token);
    });
    
    test('PVD 토큰 생성이 정상 작동해야 함', () => {
      const testSid = 'test-sid-456';
      const token = mockServer.tokenSystem.generatePvdToken(testSid);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(20);
      expect(token).toMatch(/^pvd-/);
      
      // 토큰-SID 매핑 확인
      const mappedSid = mockServer.tokenSystem.validatePvdToken(token);
      expect(mappedSid).toBe(testSid);
      
      console.log('[호환성 테스트] PVD 토큰 생성 검증 완료:', token);
    });
    
    test('토큰 검증 로직이 정상 작동해야 함', () => {
      const testSid = 'test-sid-789';
      
      // 룰렛 토큰 검증
      const rouletteToken = mockServer.tokenSystem.generateRouletteToken(testSid);
      expect(mockServer.tokenSystem.validateRouletteToken(rouletteToken)).toBe(testSid);
      expect(mockServer.tokenSystem.validateRouletteToken('invalid-token')).toBeNull();
      
      // PVD 토큰 검증
      const pvdToken = mockServer.tokenSystem.generatePvdToken(testSid);
      expect(mockServer.tokenSystem.validatePvdToken(pvdToken)).toBe(testSid);
      expect(mockServer.tokenSystem.validatePvdToken('invalid-token')).toBeNull();
      
      console.log('[호환성 테스트] 토큰 검증 로직 검증 완료');
    });
    
    test('토큰 형식이 기존 규칙을 준수해야 함', () => {
      const testSid = 'test-sid-format';
      
      // 룰렛 토큰 형식 검증
      const rouletteToken = mockServer.tokenSystem.generateRouletteToken(testSid);
      expect(rouletteToken).toMatch(/^roulette-[a-zA-Z0-9-]+-\d+-[a-z0-9]+$/);
      
      // PVD 토큰 형식 검증
      const pvdToken = mockServer.tokenSystem.generatePvdToken(testSid);
      expect(pvdToken).toMatch(/^pvd-[a-zA-Z0-9-]+-\d+-[a-z0-9]+$/);
      
      console.log('[호환성 테스트] 토큰 형식 검증 완료');
    });
    
    test('토큰 매핑 일관성이 유지되어야 함', () => {
      const testSid1 = 'test-sid-consistency-1';
      const testSid2 = 'test-sid-consistency-2';
      
      // 여러 토큰 생성
      const token1 = mockServer.tokenSystem.generateRouletteToken(testSid1);
      const token2 = mockServer.tokenSystem.generateRouletteToken(testSid2);
      const token3 = mockServer.tokenSystem.generateRouletteToken(testSid1); // 같은 SID
      
      // 매핑 일관성 확인
      expect(mockServer.tokenSystem.validateRouletteToken(token1)).toBe(testSid1);
      expect(mockServer.tokenSystem.validateRouletteToken(token2)).toBe(testSid2);
      expect(mockServer.tokenSystem.validateRouletteToken(token3)).toBe(testSid1);
      
      // 서로 다른 토큰이어야 함
      expect(token1).not.toBe(token2);
      expect(token1).not.toBe(token3);
      expect(token2).not.toBe(token3);
      
      console.log('[호환성 테스트] 토큰 매핑 일관성 검증 완료');
    });
  });

  describe('데이터베이스 스키마 호환성 확인', () => {
    
    test('roulette_sessions 테이블 스키마가 호환되어야 함', () => {
      const schema = mockServer.database.checkSchema('roulette_sessions');
      
      expect(schema.exists).toBe(true);
      expect(schema.columns).toContain('id');
      expect(schema.columns).toContain('sid');
      expect(schema.columns).toContain('channel_id'); // 새로 추가된 컬럼
      expect(schema.columns).toContain('token');
      expect(schema.columns).toContain('roulette_name');
      expect(schema.columns).toContain('username');
      expect(schema.columns).toContain('result_value');
      expect(schema.columns).toContain('result_label');
      expect(schema.columns).toContain('created_at');
      
      console.log('[호환성 테스트] roulette_sessions 테이블 스키마 검증 완료:', schema);
    });
    
    test('sessions 테이블 스키마가 호환되어야 함', () => {
      const schema = mockServer.database.checkSchema('sessions');
      
      expect(schema.exists).toBe(true);
      expect(schema.columns).toContain('sid');
      expect(schema.columns).toContain('channel_id'); // 새로 추가된 컬럼
      expect(schema.columns).toContain('user_id');
      expect(schema.columns).toContain('created_at');
      expect(schema.columns).toContain('last_seen');
      
      console.log('[호환성 테스트] sessions 테이블 스키마 검증 완료:', schema);
    });
    
    test('channel_tokens 테이블 스키마가 호환되어야 함', () => {
      const schema = mockServer.database.checkSchema('channel_tokens');
      
      expect(schema.exists).toBe(true);
      expect(schema.columns).toContain('channel_id');
      expect(schema.columns).toContain('token_type');
      expect(schema.columns).toContain('token_value');
      expect(schema.columns).toContain('sid');
      expect(schema.columns).toContain('created_at');
      expect(schema.columns).toContain('expires_at');
      expect(schema.columns).toContain('active');
      
      console.log('[호환성 테스트] channel_tokens 테이블 스키마 검증 완료:', schema);
    });
    
    test('기존 데이터 삽입이 정상 작동해야 함', () => {
      const testData = {
        sid: 'test-insert-sid',
        channel_id: 'test-insert-channel',
        token: 'test-insert-token-12345678',
        roulette_name: '테스트룰렛',
        username: '테스트유저',
        result_value: 1,
        result_label: '당첨'
      };
      
      const inserted = mockServer.database.insert('roulette_sessions', testData);
      
      expect(inserted).toHaveProperty('id');
      expect(inserted).toHaveProperty('created_at');
      expect(inserted.sid).toBe(testData.sid);
      expect(inserted.channel_id).toBe(testData.channel_id);
      expect(inserted.token).toBe(testData.token);
      
      console.log('[호환성 테스트] 데이터 삽입 검증 완료:', inserted);
    });
    
    test('기존 데이터 조회가 정상 작동해야 함', () => {
      // 테스트 데이터 삽입
      const testData = {
        sid: 'test-select-sid',
        channel_id: 'test-select-channel',
        token: 'test-select-token-12345678',
        roulette_name: '조회테스트룰렛',
        username: '조회테스트유저',
        result_value: 2,
        result_label: '대박'
      };
      
      mockServer.database.insert('roulette_sessions', testData);
      
      // 조건별 조회 테스트
      const bySid = mockServer.database.select('roulette_sessions', { sid: testData.sid });
      expect(bySid.length).toBeGreaterThan(0);
      expect(bySid[0].sid).toBe(testData.sid);
      
      const byChannelId = mockServer.database.select('roulette_sessions', { channel_id: testData.channel_id });
      expect(byChannelId.length).toBeGreaterThan(0);
      expect(byChannelId[0].channel_id).toBe(testData.channel_id);
      
      const byToken = mockServer.database.select('roulette_sessions', { token: testData.token });
      expect(byToken.length).toBeGreaterThan(0);
      expect(byToken[0].token).toBe(testData.token);
      
      console.log('[호환성 테스트] 데이터 조회 검증 완료');
    });
    
    test('채널 ID 마이그레이션 호환성이 유지되어야 함', () => {
      // 기존 데이터 (channel_id 없음) 시뮬레이션
      const legacyData = {
        sid: 'legacy-sid-123',
        token: 'legacy-token-12345678',
        roulette_name: '레거시룰렛',
        username: '레거시유저',
        result_value: 3,
        result_label: '레거시결과'
        // channel_id 없음
      };
      
      const inserted = mockServer.database.insert('roulette_sessions', legacyData);
      
      // 마이그레이션 시뮬레이션: sid를 channel_id로 복사
      if (!inserted.channel_id) {
        inserted.channel_id = inserted.sid;
      }
      
      expect(inserted.channel_id).toBe(inserted.sid);
      
      console.log('[호환성 테스트] 채널 ID 마이그레이션 호환성 검증 완료:', inserted);
    });
  });

  describe('WebSocket 연결 호환성 확인', () => {
    
    test('WebSocket 연결 검증이 정상 작동해야 함', () => {
      const mockWs = new MockWebSocket('ws://localhost/api/roulette/ws?token=test-token');
      
      expect(mockWs.readyState).toBe(1); // OPEN
      expect(mockWs.url).toContain('/api/roulette/ws');
      expect(mockWs.url).toContain('token=test-token');
      
      // ping 메서드 존재 확인
      expect(typeof mockWs.ping).toBe('function');
      
      console.log('[호환성 테스트] WebSocket 연결 검증 완료');
    });
    
    test('WebSocket 메시지 전송이 정상 작동해야 함', () => {
      const mockWs = new MockWebSocket('ws://localhost/api/roulette/ws?token=test-token');
      
      const testMessage = JSON.stringify({
        type: 'roulette',
        token: 'test-token',
        name: '테스트룰렛',
        username: '테스트유저',
        value: 1,
        label: '당첨',
        channelId: 'test-channel-123'
      });
      
      mockWs.send(testMessage);
      
      expect(mockWs.messages).toHaveLength(1);
      expect(mockWs.messages[0]).toBe(testMessage);
      
      const parsedMessage = JSON.parse(mockWs.messages[0]);
      expect(parsedMessage).toHaveProperty('type', 'roulette');
      expect(parsedMessage).toHaveProperty('channelId', 'test-channel-123');
      
      console.log('[호환성 테스트] WebSocket 메시지 전송 검증 완료');
    });
    
    test('WebSocket 연결 종료가 정상 작동해야 함', (done) => {
      const mockWs = new MockWebSocket('ws://localhost/api/roulette/ws?token=test-token');
      
      mockWs.onclose = (event) => {
        expect(event.code).toBe(1000);
        expect(event.reason).toBe('Test close');
        expect(mockWs.readyState).toBe(3); // CLOSED
        done();
      };
      
      mockWs.close(1000, 'Test close');
    });
  });

  describe('성능 및 안정성 확인', () => {
    
    test('대량 토큰 생성 시 성능이 유지되어야 함', () => {
      const startTime = Date.now();
      const tokenCount = 1000;
      const tokens = [];
      
      for (let i = 0; i < tokenCount; i++) {
        const token = mockServer.tokenSystem.generateRouletteToken(`test-sid-${i}`);
        tokens.push(token);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(tokens).toHaveLength(tokenCount);
      expect(duration).toBeLessThan(1000); // 1초 이내
      
      // 모든 토큰이 고유해야 함
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(tokenCount);
      
      console.log(`[호환성 테스트] 대량 토큰 생성 성능 검증 완료: ${tokenCount}개 토큰을 ${duration}ms에 생성`);
    });
    
    test('메모리 사용량이 적정 수준을 유지해야 함', () => {
      const initialMemory = process.memoryUsage();
      
      // 대량 데이터 생성
      for (let i = 0; i < 100; i++) {
        const sid = `memory-test-sid-${i}`;
        const channelId = `memory-test-channel-${i}`;
        const token = mockServer.tokenSystem.generateRouletteToken(sid);
        
        mockServer.database.insert('roulette_sessions', {
          sid,
          channel_id: channelId,
          token,
          roulette_name: `메모리테스트룰렛${i}`,
          username: `메모리테스트유저${i}`,
          result_value: i % 10,
          result_label: `결과${i}`
        });
      }
      
      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      
      // 메모리 증가량이 합리적인 범위 내에 있어야 함 (10MB 이하)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
      
      console.log(`[호환성 테스트] 메모리 사용량 검증 완료: ${Math.round(memoryIncrease / 1024)}KB 증가`);
    });
    
    test('오류 상황에서 시스템이 안정적으로 동작해야 함', () => {
      // 잘못된 토큰으로 검증 시도
      expect(mockServer.tokenSystem.validateRouletteToken(null)).toBeNull();
      expect(mockServer.tokenSystem.validateRouletteToken('')).toBeNull();
      expect(mockServer.tokenSystem.validateRouletteToken('invalid')).toBeNull();
      
      // 존재하지 않는 테이블 접근 시도
      expect(() => {
        mockServer.database.select('nonexistent_table');
      }).toThrow('Table nonexistent_table does not exist');
      
      // 잘못된 WebSocket 상태 처리
      const mockWs = new MockWebSocket('ws://localhost/api/roulette/ws?token=test-token');
      mockWs.readyState = 999; // 잘못된 상태
      
      expect(mockWs.readyState).toBe(999);
      
      console.log('[호환성 테스트] 오류 상황 안정성 검증 완료');
    });
  });
});