const fs = require('fs');
const path = require('path');

describe('Supabase performance monitor function regression', () => {
  const supabaseSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');
  const migrationSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '003_performance_optimization_indexes.sql'), 'utf8');

  test('monitoring functions cast pg name columns to text', () => {
    expect(migrationSource).toContain("(schemaname||'.'||relname)::TEXT as table_name");
    expect(migrationSource).toContain('indexrelname::TEXT as index_name');
    expect(migrationSource).toContain('0::NUMERIC');
  });

  test('stale deployed monitoring functions fall back on return type mismatch', () => {
    const monitorStart = supabaseSource.indexOf('export async function monitorIndexUsageSupabase');
    const monitorEnd = supabaseSource.indexOf('// 성능 권장사항 생성', monitorStart);
    const monitorBody = supabaseSource.slice(monitorStart, monitorEnd);

    expect(monitorBody).toContain("error?.code !== '42804'");
    expect(monitorBody).toContain('indexrelname::TEXT as index_name');
    expect(monitorBody).toContain('0::NUMERIC');
  });
});
