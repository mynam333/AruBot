-- 멀티 방송 지원: 기존 테이블에 채널 ID 컬럼 추가
-- Migration: 001_add_channel_id_columns.sql

-- sessions 테이블에 채널 관련 컬럼 추가
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS channel_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS isolation_level TEXT DEFAULT 'strict';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS connection_id TEXT;

-- roulette_sessions 테이블에 채널 ID 컬럼 추가
ALTER TABLE roulette_sessions ADD COLUMN IF NOT EXISTS channel_id TEXT;

-- 기존 데이터 마이그레이션: user_id를 channel_id로 복사 (임시 처리)
-- 실제 환경에서는 user_id에서 채널 ID를 추출하는 로직이 필요
UPDATE sessions 
SET channel_id = user_id 
WHERE channel_id IS NULL AND user_id IS NOT NULL;

UPDATE roulette_sessions 
SET channel_id = sid 
WHERE channel_id IS NULL AND sid IS NOT NULL;

-- 인덱스 생성 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_sessions_channel_id ON sessions(channel_id);
CREATE INDEX IF NOT EXISTS idx_sessions_isolation ON sessions(isolation_level);
CREATE INDEX IF NOT EXISTS idx_sessions_connection_id ON sessions(connection_id);
CREATE INDEX IF NOT EXISTS idx_roulette_sessions_channel_id ON roulette_sessions(channel_id);

-- 복합 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_sessions_channel_isolation ON sessions(channel_id, isolation_level);
CREATE INDEX IF NOT EXISTS idx_roulette_sessions_channel_sid ON roulette_sessions(channel_id, sid);

-- 데이터 무결성 검증을 위한 뷰 생성
CREATE OR REPLACE VIEW channel_data_integrity AS
SELECT 
  'sessions' as table_name,
  COUNT(*) as total_rows,
  COUNT(channel_id) as rows_with_channel_id,
  COUNT(*) - COUNT(channel_id) as rows_missing_channel_id
FROM sessions
UNION ALL
SELECT 
  'roulette_sessions' as table_name,
  COUNT(*) as total_rows,
  COUNT(channel_id) as rows_with_channel_id,
  COUNT(*) - COUNT(channel_id) as rows_missing_channel_id
FROM roulette_sessions;

-- 마이그레이션 로그 테이블 생성
CREATE TABLE IF NOT EXISTS migration_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  migration_name TEXT NOT NULL,
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL, -- 'success', 'failed', 'rollback'
  details JSONB,
  execution_time_ms INTEGER
);

-- 현재 마이그레이션 기록
INSERT INTO migration_log (migration_name, status, details) 
VALUES ('001_add_channel_id_columns', 'success', '{"description": "Added channel_id columns to sessions and roulette_sessions tables"}');