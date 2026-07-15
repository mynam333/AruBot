const fs = require('fs');
const path = require('path');

describe('PostgreSQL channel point identifier regression', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');
  const pointsStart = source.indexOf('// ---------------- Channel Points');
  const pointsEnd = source.indexOf('// --- Sessions', pointsStart);
  const points = source.slice(pointsStart, pointsEnd);
  const predictionStart = source.indexOf('export async function cancelPredictionForSid');
  const predictionEnd = source.indexOf('export async function placePredictionBet', predictionStart);
  const predictions = source.slice(predictionStart, predictionEnd);

  test('preserves mixed-case YouTube channel table names with a qualified quoted identifier', () => {
    expect(points).toContain('function quoteChannelPointsTable(table)');
    expect(points).toContain("return quoteIdent(`public.${name}`)");
    expect(points).toContain('const tableSql = quoteChannelPointsTable(table)');
    expect(points).toContain('from ${quoteChannelPointsTable(table)}');
    expect(points).toContain('table_name = any($1::text[])');
    expect(points).toContain('tables.push(...(legacyTables.rows || [])');
    expect(points).toContain('quoteChannelPointsTable(canonicalTable)');
    expect(points).toContain('return legacyTable === table ? [] : [legacyTable]');
  });

  test('does not leave unquoted dynamic identifiers in point operations', () => {
    expect(points).not.toMatch(/(?:from|into|delete from) \$\{table\}/);
    expect(points).not.toContain('${table}.username');
    expect(points).not.toContain('${table}.points');
    expect(points).not.toContain('quoteIdent(canonicalTable)');
    expect(predictions).not.toMatch(/(?:from|into|delete from) \$\{table\}/);
    expect(predictions).not.toContain('${table}.username');
    expect(predictions).not.toContain('${table}.points');
  });

  test('account cleanup recognizes both canonical and legacy lowercase channel tables', () => {
    expect(source).toContain('return [table, table.toLowerCase()]');
  });

  test('only skips a table that disappeared after enumeration', () => {
    const viewerStart = points.indexOf('export async function listViewerPointBalancesForUserIds');
    const viewerEnd = points.indexOf('function uniqueNonEmpty', viewerStart);
    const viewer = points.slice(viewerStart, viewerEnd);
    expect(viewer).toContain("if (error?.code === '42P01') continue");
    expect(viewer).toContain('throw error');
  });
});
