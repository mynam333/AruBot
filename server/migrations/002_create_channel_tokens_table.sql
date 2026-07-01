-- 멀티 방송 지원: 채널 토큰 관리 테이블 생성
-- Migration: 002_create_channel_tokens_table.sql

-- 채널 토큰 관리 테이블 생성
CREATE TABLE IF NOT EXISTS channel_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id TEXT NOT NULL,
  token_type TEXT NOT NULL, -- 'roulette', 'pvd', 'api'
  token_value TEXT NOT NULL UNIQUE,
  sid TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  last_used TIMESTAMPTZ,
  active BOOLEAN DEFAULT TRUE,
  usage_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::JSONB
);

-- 토큰 타입별 인덱스 및 제약조건 설정
CREATE INDEX IF NOT EXISTS idx_channel_tokens_channel_type ON channel_tokens(channel_id, token_type);
CREATE INDEX IF NOT EXISTS idx_channel_tokens_value ON channel_tokens(token_value);
CREATE INDEX IF NOT EXISTS idx_channel_tokens_sid ON channel_tokens(sid);
CREATE INDEX IF NOT EXISTS idx_channel_tokens_active ON channel_tokens(active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_channel_tokens_expires ON channel_tokens(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channel_tokens_last_used ON channel_tokens(last_used DESC);

-- 복합 인덱스 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_channel_tokens_channel_active ON channel_tokens(channel_id, active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_channel_tokens_type_active ON channel_tokens(token_type, active) WHERE active = TRUE;

-- 토큰 타입 제약조건
ALTER TABLE channel_tokens ADD CONSTRAINT chk_token_type 
  CHECK (token_type IN ('roulette', 'pvd', 'api'));

-- 토큰 값 길이 제약조건
ALTER TABLE channel_tokens ADD CONSTRAINT chk_token_value_length 
  CHECK (LENGTH(token_value) >= 8 AND LENGTH(token_value) <= 255);

-- 토큰 사용 통계 뷰
CREATE OR REPLACE VIEW channel_token_stats AS
SELECT 
  channel_id,
  token_type,
  COUNT(*) as total_tokens,
  COUNT(*) FILTER (WHERE active = TRUE) as active_tokens,
  COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < NOW()) as expired_tokens,
  AVG(usage_count) as avg_usage_count,
  MAX(last_used) as last_activity
FROM channel_tokens
GROUP BY channel_id, token_type;

-- 만료된 토큰 정리 함수
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- 만료된 토큰을 비활성화
  UPDATE channel_tokens 
  SET active = FALSE 
  WHERE expires_at IS NOT NULL 
    AND expires_at < NOW() 
    AND active = TRUE;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- 30일 이상 된 비활성 토큰 삭제
  DELETE FROM channel_tokens 
  WHERE active = FALSE 
    AND created_at < NOW() - INTERVAL '30 days';
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 토큰 생성 함수
CREATE OR REPLACE FUNCTION generate_channel_token(
  p_channel_id TEXT,
  p_token_type TEXT,
  p_sid TEXT,
  p_expires_hours INTEGER DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
  new_token TEXT;
  token_exists BOOLEAN;
BEGIN
  -- 토큰 타입 검증
  IF p_token_type NOT IN ('roulette', 'pvd', 'api') THEN
    RAISE EXCEPTION 'Invalid token type: %', p_token_type;
  END IF;
  
  -- 고유한 토큰 생성
  LOOP
    new_token := encode(gen_random_bytes(32), 'hex');
    
    SELECT EXISTS(SELECT 1 FROM channel_tokens WHERE token_value = new_token) INTO token_exists;
    
    EXIT WHEN NOT token_exists;
  END LOOP;
  
  -- 토큰 저장
  INSERT INTO channel_tokens (
    channel_id, 
    token_type, 
    token_value, 
    sid,
    expires_at
  ) VALUES (
    p_channel_id,
    p_token_type,
    new_token,
    p_sid,
    CASE 
      WHEN p_expires_hours IS NOT NULL THEN NOW() + (p_expires_hours || ' hours')::INTERVAL
      ELSE NULL
    END
  );
  
  RETURN new_token;
END;
$$ LANGUAGE plpgsql;

-- 토큰 검증 함수
CREATE OR REPLACE FUNCTION validate_channel_token(
  p_token_value TEXT,
  p_expected_channel_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  token_record RECORD;
  result JSONB;
BEGIN
  -- 토큰 조회
  SELECT * INTO token_record
  FROM channel_tokens 
  WHERE token_value = p_token_value 
    AND active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW());
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Token not found or expired'
    );
  END IF;
  
  -- 채널 ID 검증 (선택적)
  IF p_expected_channel_id IS NOT NULL AND token_record.channel_id != p_expected_channel_id THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Channel mismatch'
    );
  END IF;
  
  -- 사용 횟수 증가
  UPDATE channel_tokens 
  SET usage_count = usage_count + 1,
      last_used = NOW()
  WHERE token_value = p_token_value;
  
  -- 결과 반환
  RETURN jsonb_build_object(
    'valid', true,
    'channel_id', token_record.channel_id,
    'token_type', token_record.token_type,
    'sid', token_record.sid,
    'usage_count', token_record.usage_count + 1
  );
END;
$$ LANGUAGE plpgsql;

-- 마이그레이션 로그 기록
INSERT INTO migration_log (migration_name, status, details) 
VALUES ('002_create_channel_tokens_table', 'success', '{"description": "Created channel_tokens table with indexes and functions"}');