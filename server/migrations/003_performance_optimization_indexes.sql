-- 멀티 방송 지원: 성능 최적화 인덱스 생성
-- Migration: 003_performance_optimization_indexes.sql

-- 복합 인덱스 (채널 ID 기반 조회 최적화)
CREATE INDEX IF NOT EXISTS idx_sessions_channel_user_active ON sessions(channel_id, user_id, expires_at)
  WHERE revoked = FALSE;

CREATE INDEX IF NOT EXISTS idx_roulette_sessions_channel_created ON roulette_sessions(channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_tokens_channel_type_active ON channel_tokens(channel_id, token_type, active) 
  WHERE active = TRUE;

-- 부분 인덱스 (조건부 인덱스로 성능 향상)
CREATE INDEX IF NOT EXISTS idx_sessions_active_by_channel ON sessions(channel_id, last_seen DESC, expires_at)
  WHERE revoked = FALSE;

CREATE INDEX IF NOT EXISTS idx_channel_tokens_unexpired ON channel_tokens(channel_id, token_type, expires_at, created_at DESC)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_roulette_sessions_recent ON roulette_sessions(channel_id, sid, created_at DESC);

-- 통계 수집을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_channel_tokens_usage_stats ON channel_tokens(channel_id, token_type, usage_count DESC, last_used DESC) 
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_roulette_sessions_stats ON roulette_sessions(channel_id, roulette_name, created_at DESC);

-- 정리 작업을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_channel_tokens_cleanup ON channel_tokens(expires_at, active) 
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_cleanup ON sessions(expires_at, revoked) 
  WHERE expires_at IS NOT NULL;

-- 함수 기반 인덱스 (PostgreSQL 전용)
CREATE INDEX IF NOT EXISTS idx_sessions_channel_hash ON sessions(channel_id) 
  WHERE channel_id IS NOT NULL;

DROP FUNCTION IF EXISTS analyze_channel_query_performance();
DROP FUNCTION IF EXISTS monitor_index_usage();
DROP FUNCTION IF EXISTS update_channel_statistics();
DROP FUNCTION IF EXISTS get_performance_recommendations();

-- 성능 모니터링을 위한 뷰
CREATE OR REPLACE VIEW channel_performance_stats AS
SELECT 
  s.channel_id,
  COUNT(DISTINCT s.sid) as active_sessions,
  COUNT(DISTINCT rs.token) as roulette_sessions_today,
  COUNT(DISTINCT ct.token_value) as active_tokens,
  AVG(ct.usage_count) as avg_token_usage,
  MAX(s.last_seen) as last_activity
FROM sessions s
LEFT JOIN roulette_sessions rs ON s.channel_id = rs.channel_id 
  AND rs.created_at > NOW() - INTERVAL '1 day'
LEFT JOIN channel_tokens ct ON s.channel_id = ct.channel_id 
  AND ct.active = TRUE
WHERE s.revoked = FALSE 
  AND (s.expires_at IS NULL OR s.expires_at > NOW())
  AND s.channel_id IS NOT NULL
GROUP BY s.channel_id;

-- 쿼리 성능 분석을 위한 함수
CREATE OR REPLACE FUNCTION analyze_channel_query_performance()
RETURNS TABLE(
  table_name TEXT,
  index_name TEXT,
  index_usage_count BIGINT,
  table_size TEXT,
  index_size TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (schemaname||'.'||relname)::TEXT as table_name,
    indexrelname::TEXT as index_name,
    idx_tup_read as index_usage_count,
    pg_size_pretty(pg_total_relation_size(relid)) as table_size,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
  FROM pg_stat_user_indexes 
  WHERE schemaname = 'public' 
    AND (relname LIKE '%session%' OR relname LIKE '%token%' OR relname = 'roulette_sessions')
  ORDER BY idx_tup_read DESC;
END;
$$ LANGUAGE plpgsql;

-- 인덱스 사용률 모니터링 함수
CREATE OR REPLACE FUNCTION monitor_index_usage()
RETURNS TABLE(
  table_name TEXT,
  index_name TEXT,
  usage_ratio NUMERIC,
  recommendation TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (schemaname||'.'||relname)::TEXT as table_name,
    indexrelname::TEXT as index_name,
    CASE 
      WHEN idx_tup_read + idx_tup_fetch = 0 THEN 0::NUMERIC
      ELSE ROUND((idx_tup_read::NUMERIC / (idx_tup_read + idx_tup_fetch + 1)) * 100, 2)
    END as usage_ratio,
    CASE 
      WHEN idx_tup_read + idx_tup_fetch = 0 THEN 'Consider dropping - unused index'
      WHEN idx_tup_read::NUMERIC / (idx_tup_read + idx_tup_fetch + 1) < 0.1 THEN 'Low usage - review necessity'
      WHEN idx_tup_read::NUMERIC / (idx_tup_read + idx_tup_fetch + 1) > 0.8 THEN 'High usage - keep index'
      ELSE 'Moderate usage - monitor'
    END as recommendation
  FROM pg_stat_user_indexes 
  WHERE schemaname = 'public' 
    AND (relname LIKE '%session%' OR relname LIKE '%token%' OR relname = 'roulette_sessions')
  ORDER BY usage_ratio DESC;
END;
$$ LANGUAGE plpgsql;

-- 자동 통계 업데이트 함수
CREATE OR REPLACE FUNCTION update_channel_statistics()
RETURNS VOID AS $$
BEGIN
  -- 테이블 통계 업데이트
  ANALYZE sessions;
  ANALYZE channel_tokens;
  ANALYZE roulette_sessions;
  
EXCEPTION
  WHEN OTHERS THEN
    -- 에러 발생 시 로그만 남기고 계속 진행
    RAISE NOTICE 'Statistics update failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- 성능 최적화 권장사항 함수
CREATE OR REPLACE FUNCTION get_performance_recommendations()
RETURNS TABLE(
  category TEXT,
  recommendation TEXT,
  priority TEXT,
  estimated_impact TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH table_stats AS (
    SELECT 
      (schemaname||'.'||tablename)::TEXT as full_name,
      n_tup_ins + n_tup_upd + n_tup_del as total_modifications,
      n_tup_hot_upd,
      n_dead_tup,
      last_vacuum,
      last_analyze
    FROM pg_stat_user_tables 
    WHERE schemaname = 'public' 
      AND (tablename LIKE '%session%' OR tablename LIKE '%token%' OR tablename = 'roulette_sessions')
  )
  SELECT 
    'Maintenance'::TEXT as category,
    ('Run VACUUM on ' || full_name)::TEXT as recommendation,
    (CASE WHEN n_dead_tup > 1000 THEN 'High' ELSE 'Medium' END)::TEXT as priority,
    'Improved query performance'::TEXT as estimated_impact
  FROM table_stats 
  WHERE n_dead_tup > 100
  
  UNION ALL
  
  SELECT 
    'Statistics'::TEXT as category,
    ('Run ANALYZE on ' || full_name)::TEXT as recommendation,
    (CASE WHEN last_analyze < NOW() - INTERVAL '1 week' THEN 'High' ELSE 'Low' END)::TEXT as priority,
    'Better query planning'::TEXT as estimated_impact
  FROM table_stats 
  WHERE last_analyze IS NULL OR last_analyze < NOW() - INTERVAL '3 days'
  
  ORDER BY 
    CASE priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
    category;
END;
$$ LANGUAGE plpgsql;

-- 마이그레이션 로그 기록
INSERT INTO migration_log (migration_name, status, details) 
VALUES ('003_performance_optimization_indexes', 'success', '{"description": "Created performance optimization indexes and monitoring functions"}');
